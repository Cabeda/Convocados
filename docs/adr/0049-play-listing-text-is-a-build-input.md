# The Play listing text is a build input, and a Wear surface without a line in it is a red release

Google Play rejected the Wear app under the Wear App Quality Guidelines because the store
listing did not mention the tile, while the quick-game tile (`QuickGameTileService`) had
shipped for months. The finding was correct, and it was free to happen: screenshots were
committed Roborazzi sources uploaded by `syncPlayListings`, but the *text* was typed into
Play Console by hand, outside version control and outside review. The copy in production was
152 characters written for a companion app — "Manages the scores and teams for the
convocados app" — for a standalone Wear OS app whose selling points are a home-screen
tile, a watch-face live-score indicator, on-watch Google sign-in, and scoring that works
with no coverage at all.

So the defect is not the wording. It is that the copy is not a build input, which leaves
every future surface free to ship undocumented and the next rejection free to arrive
weeks later. Listing text therefore becomes committed source at
`android-app/store-listing/<lang>/`, staged into both modules' Play listing layout by
`syncPlayListingText` and uploaded by the existing `publishListing` step like any other
asset. Play Console stops being the source of truth for text, and a hand-edit there is
overwritten by the next release.

The rule that matters is the gate. `scripts/check-play-listing.mjs` reads the wear module —
its manifest and its Kotlin sources — and a surface that exists in code obliges a line in
the description: a tile (`BIND_TILE_PROVIDER` or a `TileService`) requires the word "tile",
an ongoing activity (`OngoingActivity`) requires "ongoing", a complication requires
"complication". Adding one of those to the app adds the obligation without touching the
script, and forgetting the line costs a red release in review — the check runs in GATE 1 and
in the Play publish job — instead of a policy rejection days later.

The obligation is derived from the *sources*, not from a dependency line, so restyling a
`build.gradle.kts` cannot silently disarm it. It is not self-extending, and saying so is
part of the decision: the detector list is bounded by the three surfaces Play's guidelines
name, a watch face is excluded because the copy legitimately says "watch face" when it
describes the live-score indicator, and anything outside that set is caught by review —
which is why adding a Wear surface means editing the description in the same PR. A gate that
claimed to cover the unknown would be a gate nobody could trust.
`src/test/play-listing.test.ts` drives the failing paths through that same module — a second
implementation of the rules would stay green while the real gate decayed, so there is only
one.

The gate also requires all three text fields per language and enforces Play's own limits:
Play replaces the whole listing resource, so a partial listing clears fields rather than
leaving them alone. What it does *not* do is invent a required language set — the app ships
six locales, the Play listing is en-US, and adding a Play locale is a copy decision someone
makes deliberately. Every language directory that exists is held to the full standard; the
gate cannot notice a locale that was never added.

Both modules publish under the same `applicationId`, so the phone and Wear store pages
render one listing, and the description has to serve both: it leads with what the product
does for anyone, then documents the Wear surfaces explicitly. The staging task never
deletes `.../listings/<lang>/`, because the sibling graphics tasks stage screenshots into
`.../listings/<lang>/graphics/` and Gradle guarantees no order between them — wiping the
directory would discard screenshots the same build had just staged, silently, with both
tasks reporting success.
