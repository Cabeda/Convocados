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

The rule that matters is the gate. The task reads the Wear manifest and build file: a
declared `BIND_TILE_PROVIDER` tile service, or the `wear-ongoing` dependency behind the
live-score indicator, obliges the full description to mention "tile" / "ongoing". Adding a
Wear surface costs a sentence, and forgetting it costs a red release in review — the same
task runs in GATE 1 — instead of a policy rejection in production. The obligation is
*derived* from where a feature is declared rather than kept in a hand-written checklist,
because a checklist is precisely the artefact that drifts. The task also requires all
three text fields per language and enforces Play's own limits: Play replaces the whole
listing resource, so a partial listing clears fields instead of leaving them alone.

Both modules publish under the same `applicationId`, so the phone and Wear store pages
render one listing, and the description has to serve both: Wear-only surfaces are described
explicitly, and the phone-only work (attendance, payments, seasons) is named as such rather
than implied. Adding a Wear tile, complication or watch face means editing
`android-app/store-listing/<lang>/full_description.txt` in the same PR as the feature. That
friction is the point — it is a Play requirement, not ceremony. The listing remains en-US
only, and every language the app is published in is obliged the same way.
