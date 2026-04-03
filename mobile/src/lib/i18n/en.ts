// English — mobile translation keys (subset of web keys + mobile-specific)
const en = {
  // App
  appName: "Convocados",

  // Tabs
  games: "Games",
  stats: "Stats",
  profile: "Profile",

  // Login
  signIn: "Sign in",
  loginFailed: "Login failed",
  manageGames: "Manage your games on the go",

  // Games tab
  noGamesYet: "No games yet",
  noGamesDesc: "Create a game or join one to get started.",
  myGames: "My Games",
  joinedGames: "Joined",
  archivedGames: "Archived",
  loadMore: "Load more",
  retry: "Retry",

  // Create event
  createGame: "Create a Game",
  gameTitle: "Game title",
  gameTitlePlaceholder: "e.g. Tuesday 5-a-side",
  location: "Location",
  locationPlaceholder: "e.g. Riverside Astro, Pitch 2",
  locationOptional: "Location (optional)",
  dateTime: "Date & time",
  maxPlayers: "Max players",
  maxPlayersHelper: "Players beyond this limit go to the bench",
  maxPlayersError: "Max players must be between 2 and 100",
  sport: "Sport",
  creating: "Creating…",
  createGameBtn: "Create game",
  advancedOptions: "Advanced options",
  teamNames: "Team names",
  team1Name: "Team 1 name",
  team2Name: "Team 2 name",

  // Sports
  sportFootball5v5: "Football 5v5",
  sportFootball7v7: "Football 7v7",
  sportFootball11v11: "Football 11v11",
  sportFutsal: "Futsal",
  sportBasketball: "Basketball",
  sportVolleyball: "Volleyball",
  sportTennisSingles: "Tennis (singles)",
  sportTennisDoubles: "Tennis (doubles)",
  sportPadel: "Padel",
  sportOther: "Other",

  // Event detail
  playing: "Playing ({n}/{max})",
  bench: "Bench ({n})",
  addPlayerPlaceholder: "Add player name",
  add: "Add",
  history: "History",
  noHistory: "No past games yet.",
  teams: "Teams",
  vs: "VS",

  // Quick join
  quickJoinTitle: "Join this game",
  quickJoinBtn: "Join",
  quickJoinLeave: "Leave",
  youArePlaying: "You joined as {name}",
  youAreOnBench: "You're on the bench",

  // Share
  shareGame: "Share",
  linkCopied: "Link copied!",
  spotsLeft: "{n} spot(s) left",
  full: "Full",

  // Randomize
  randomizeTeams: "Randomize teams",
  rerandomizeTitle: "Re-randomize teams?",
  rerandomizeDesc: "Teams have already been set. Randomizing again will replace the current assignment.",
  randomize: "Randomize",

  // Score
  score: "Score",
  saveScore: "Save score",
  editScore: "Edit score",

  // Settings
  settings: "Settings",
  eventSettings: "Event settings",

  // Errors
  somethingWentWrong: "Something went wrong.",
  errorPlayerNameRequired: "Player name is required.",
  errorPlayerDuplicate: '"{name}" is already in the list.',
  errorNeedMorePlayers: "Need at least 2 players.",
  eventNotFound: "Event not found",

  // Common
  cancel: "Cancel",
  save: "Save",
  delete: "Delete",
  confirm: "Confirm",
  done: "Done",
  remove: "Remove",
  goBack: "Go back",
  signOut: "Sign out",
  serverUrl: "Server URL",
  configureInstance: "Configure instance",
  invalidUrl: "Invalid URL",
  urlMustStartWithHttp: "Server URL must start with http:// or https://",
  saved: "Saved",
  serverUrlUpdated: "Server URL updated. Please sign out and sign in again.",
  signOutConfirm: "Are you sure?",
  removePlayer: "Remove {name}?",
  language: "Language",

  // Stats
  overview: "Overview",
  gamesPlayed: "Games",
  wins: "Wins",
  draws: "Draws",
  losses: "Losses",
  winRate: "Win Rate",
  avgRating: "Avg Rating",
  perEvent: "Per Event",
  attendance: "Attendance",
  streak: "Streak",
  rating: "Rating",

  // Polling
  lastUpdated: "Updated {time}",
} as const;

export default en;
export type TranslationKeys = Record<keyof typeof en, string>;
