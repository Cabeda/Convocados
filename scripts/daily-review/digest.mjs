#!/usr/bin/env node
/**
 * Post the daily-review digest to the rolling "Daily reviews" GitHub Discussion.
 *
 * The digest is the human timeline: what ran, what was filed, what was deferred.
 * It is advisory — a failure here never fails the review. Set
 * DAILY_REVIEW_DIGEST=off to skip it.
 *
 * Usage: node scripts/daily-review/digest.mjs [--dry-run]  (Markdown on stdin)
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const DISCUSSION_TITLE = "Daily reviews";
const DISCUSSION_INTRO =
  "Rolling log of the daily senior review. One comment per day: what ran, what was filed, " +
  "what was deferred. Issues are the output; this is the timeline.";

/** Prefer the configured category by name, then General, then the first one. */
export function pickCategory(categories, preferred) {
  if (!Array.isArray(categories) || categories.length === 0) return null;
  return (
    categories.find((category) => category.name === preferred) ??
    categories.find((category) => category.name === "General") ??
    categories[0]
  );
}

/** @param {Array<{ title?: string, id?: string, url?: string }>} nodes */
export function pickDiscussion(nodes, title = DISCUSSION_TITLE) {
  if (!Array.isArray(nodes)) return null;
  return nodes.find((node) => node.title === title) ?? null;
}

export function renderDigestBody(text) {
  return text.trim() + "\n";
}

export function parseGraphql(output) {
  const parsed = JSON.parse(output);
  if (parsed.errors?.length) {
    throw new Error(parsed.errors.map((error) => error.message).join("; "));
  }
  return parsed.data;
}

function defaultGraphql(query, variables = {}) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    args.push("-f", `${key}=${value}`);
  }
  const output = execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return parseGraphql(output);
}

const REPO_QUERY = `
  query($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      id
      discussionCategories(first: 20) { nodes { id name } }
    }
  }
`;

const SEARCH_QUERY = `
  query($q: String!) {
    search(query: $q, type: DISCUSSION, first: 10) {
      nodes { ... on Discussion { id title url } }
    }
  }
`;

const CREATE_MUTATION = `
  mutation($repo: ID!, $category: ID!, $title: String!, $body: String!) {
    createDiscussion(input: { repositoryId: $repo, categoryId: $category, title: $title, body: $body }) {
      discussion { id url }
    }
  }
`;

const COMMENT_MUTATION = `
  mutation($discussion: ID!, $body: String!) {
    addDiscussionComment(input: { discussionId: $discussion, body: $body }) {
      comment { url }
    }
  }
`;

/**
 * @param {{
 *   text: string,
 *   owner: string,
 *   repo: string,
 *   preferredCategory?: string,
 *   graphql?: (query: string, variables?: Record<string, string>) => any,
 *   dryRun?: boolean,
 * }} options
 */
export function postDigest({
  text,
  owner,
  repo,
  preferredCategory = "General",
  graphql = defaultGraphql,
  dryRun = false,
}) {
  const body = renderDigestBody(text);
  if (body.trim().length < 50) {
    return { status: "skipped", reason: "digest is shorter than 50 characters" };
  }

  const repoData = graphql(REPO_QUERY, { owner, name: repo });
  const repository = repoData?.repository;
  if (!repository?.id) return { status: "skipped", reason: "repository not found" };

  const category = pickCategory(repository.discussionCategories?.nodes ?? [], preferredCategory);
  if (!category) return { status: "skipped", reason: "no discussion category available" };

  const search = graphql(SEARCH_QUERY, { q: `repo:${owner}/${repo} in:title "${DISCUSSION_TITLE}"` });
  let discussion = pickDiscussion(search?.search?.nodes ?? []);

  if (!discussion) {
    if (dryRun) {
      return {
        status: "would-create",
        discussion: DISCUSSION_TITLE,
        category: category.name,
        body: body.slice(0, 200),
      };
    }
    const created = graphql(CREATE_MUTATION, {
      repo: repository.id,
      category: category.id,
      title: DISCUSSION_TITLE,
      body: DISCUSSION_INTRO,
    });
    discussion = created?.createDiscussion?.discussion;
    if (!discussion?.id) return { status: "skipped", reason: "discussion creation returned no id" };
  }

  if (dryRun) {
    return { status: "would-comment", discussion: discussion.title ?? DISCUSSION_TITLE, url: discussion.url };
  }

  const commented = graphql(COMMENT_MUTATION, { discussion: discussion.id, body });
  const url = commented?.addDiscussionComment?.comment?.url;
  return { status: "posted", discussion: discussion.title ?? DISCUSSION_TITLE, url: url ?? discussion.url };
}

function main(argv) {
  const dryRun = argv.includes("--dry-run");
  if (process.env.DAILY_REVIEW_DIGEST === "off") {
    console.log(JSON.stringify({ status: "skipped", reason: "DAILY_REVIEW_DIGEST=off" }, null, 2));
    return 0;
  }

  let text;
  try {
    text = readFileSync(0, "utf8");
  } catch (error) {
    console.error(JSON.stringify({ status: "skipped", reason: `could not read stdin: ${String(error)}` }));
    return 0;
  }

  try {
    const result = postDigest({
      text,
      owner: process.env.DAILY_REVIEW_OWNER ?? "Cabeda",
      repo: process.env.DAILY_REVIEW_REPO ?? "Convocados",
      preferredCategory: process.env.DAILY_REVIEW_DISCUSSION_CATEGORY ?? "General",
      dryRun,
    });
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    // Advisory: never fail the review because the digest could not be posted.
    console.log(JSON.stringify({ status: "skipped", reason: String(error?.message ?? error) }, null, 2));
    return 0;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main(process.argv.slice(2));
}
