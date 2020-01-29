import {Randomize} from './random';

const players = ["A", "B", "C", "D"]
const teams = ["Braga", "Porto"]
test('returns a match given a list', () => {

    const item = Randomize(players, teams)
    expect(item.length).toBe(4)
});
