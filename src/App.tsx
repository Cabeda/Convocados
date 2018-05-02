import * as React from 'react';
import { Imatch } from '../public/Shared/match.interface';
import { IRandomizer } from '../public/Shared/random.interface';
import './App.css';
import logo from './ball.svg';


class App extends React.Component<any, IRandomizer> {


  public players: string[] = ["Moura", "Cabeda", "Ricardo", "Ivan", "André Sousa", "Simão", "João"];

  public teams: string[] = ["Egypt", "Morocco",
    "Nigeria", "Senegal", "Tunisia", "Australia",
    "Iran",
    "Japan",
    "Korea Republic",
    "Saudi Arabia",
    "Belgium",
    "Croatia",
    "Denmark",
    "England",
    "France",
    "Germany",
    "Iceland",
    "Poland",
    "Portugal",
    "Russia",
    "Serbia",
    "Spain",
    "Sweden",
    "Switzerland",
    "Costa Rica",
    "Mexico",
    "Panama",
    "Argentina",
    "Brazil",
    "Colombia",
    "Peru",
    "Uruguay"];

  constructor(props: any) {
    super(props);
    this.state = {
      players: this.players,
      result: [],
      teams: this.teams
    };

    this.handleTeamsChange = this.handleTeamsChange.bind(this);
    this.handlePlayersChange = this.handlePlayersChange.bind(this);
    this.randomize = this.randomize.bind(this);
  }

  public handleTeamsChange(event: React.FormEvent<HTMLTextAreaElement>) {
    this.setState({ teams: this.getItemsFromTextArea(event.currentTarget.value) });
  }

  public handlePlayersChange(event: React.FormEvent<HTMLTextAreaElement>) {
    this.setState({ players: this.getItemsFromTextArea(event.currentTarget.value) });
  }

  public getItemsFromTextArea(text: string): string[] {
    return text.split(",");
  }

  public printResults(list: Imatch[]): string {
    let result: string = "";
    for (const item of list) {
      result += "\n" + item.player + " - " + item.team;
    };
    return result;
  }

  public getItemFromList(list: string[]) {
    const item = list.splice(Math.floor((Math.random() * list.length)), 1)[0];
    return item.trim();
  }


  public randomize() {
    const matches: Imatch[] = [];
    const playersLength = this.state.players.length;
    const playersToAdd = JSON.parse(JSON.stringify(this.state.players));
    const teamsToAdd = JSON.parse(JSON.stringify(this.state.teams));

    for (let i = 0; i < playersLength; i++) {
      const player: string = this.getItemFromList(playersToAdd);
      const team: string = this.getItemFromList(teamsToAdd);
      const newTeam: Imatch = { player, team };

      matches.push(newTeam);
    }

    this.setState({ result: matches });
  }

  public render() {
    return (
      <div className="App">
        <header className="App-header">
          <img src={logo} className="App-logo" alt="logo" />
          <h1 className="App-title">Team Randomizer</h1>
        </header>
        <div>

          <textarea id="players" placeholder="Insert players here" value={this.state.players} onChange={this.handlePlayersChange} />
          <textarea id="teams" placeholder="Insert teams here" value={this.state.teams} onChange={this.handleTeamsChange} />
        </div>
        <button id="randomizeBtn" onClick={this.randomize}>
          <h4 >Randomize!!!</h4>
        </button>
        <textarea id="result" value={this.printResults(this.state.result)} />
      </div>
    );
  }
}

export default App;
