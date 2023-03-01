import { Randomize } from "./random";

const players = ["A", "B", "C", "D"];
const teams = ["Braga", "Porto"];
test("returns a match given a list", () => {
  const items = Randomize(players, teams);
  expect(items.length).toBe(2);
  console.log(items[0]);
});
