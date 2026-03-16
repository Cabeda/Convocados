export const translations = {
  en: {
    // App
    appName: "Convocados",
    toggleDarkMode: "Toggle dark mode",
    viewOnGithub: "View on GitHub",

    // CreateEventForm
    createGame: "Create a Game",
    createGameSubtitle: "Set up your football game and share the link with your players.",
    gameTitle: "Game title",
    gameTitlePlaceholder: "e.g. Tuesday 5-a-side",
    location: "Location",
    locationPlaceholder: "e.g. Riverside Astro, Pitch 2",
    locationOptional: "Location (optional)",
    dateTime: "Date & time",
    teamNames: "Team names",
    team1Name: "Team 1 name",
    team2Name: "Team 2 name",
    recurrence: "Recurrence",
    recurringGame: "Recurring game",
    every: "Every",
    frequency: "Frequency",
    weeks: "week(s)",
    months: "month(s)",
    onDay: "On day (optional)",
    sameDayAsEvent: "Same day as event",
    recurrenceInfo: "The player list resets 1 hour after each game. The link stays the same.",
    creating: "Creating…",
    createGameBtn: "Create game",
    somethingWentWrong: "Something went wrong.",
    advancedOptions: "Advanced options",
    maxPlayers: "Max players",
    maxPlayersHelper: "Players beyond this limit go to the bench",

    // Bench
    activePlayers: "Playing ({n}/{max})",
    benchPlayers: "Bench ({n})",
    benchInfo: "Bench players are automatically promoted when a spot opens up.",
    youAreOnBench: "You're on the bench — you'll be promoted if a spot opens.",
    youArePlaying: "You joined as {name}",

    // Days
    monday: "Monday",
    tuesday: "Tuesday",
    wednesday: "Wednesday",
    thursday: "Thursday",
    friday: "Friday",
    saturday: "Saturday",
    sunday: "Sunday",

    // EventPage
    gameTime: "Game time!",
    gameNotFound: "Game not found",
    gameNotFoundDesc: "This link may be invalid or expired.",
    createNewGame: "Create a new game",
    recurringResetAlert: "This recurring game was reset for the next occurrence on {date}. The player list has been cleared.",
    copyLink: "Copy link",
    players: "Players",
    addPlayerPlaceholder: "Add player name",
    addPlayerHelper: "Press Enter to add, or paste a newline-separated list",
    randomizeTeams: "Randomize teams",
    teamsOutOfSync: "Players have changed since teams were last randomized. Consider re-randomizing.",
    teams: "Teams",
    vs: "vs",
    rerandomizeTitle: "Re-randomize teams?",
    rerandomizeDesc: "Teams have already been set. Randomizing again will replace the current assignment.",
    cancel: "Cancel",
    randomize: "Randomize",
    linkCopied: "Link copied!",
    renameTeam: "Rename {label}",

    // Share
    shareGame: "Share with players",
    shareGameMobile: "Share",
    linkCopiedFull: "Link copied to clipboard!",

    // Quick join
    quickJoinTitle: "Join this game",
    quickJoinPlaceholder: "Your name",
    quickJoinBtn: "Join",
    quickJoinedAs: "You joined as {name}",
    quickJoinLeave: "Leave",
    recentPlayers: "Recent players",
    showAllPlayers: "Show all",
    noSuggestions: "Type a new name",

    // History
    history: "History",
    viewHistory: "View history",
    noHistory: "No past games yet.",
    noHistoryDesc: "History is recorded automatically after each recurring game.",
    statusPlayed: "Played",
    statusCancelled: "Cancelled",
    markPlayed: "Mark as played",
    markCancelled: "Mark as cancelled",
    score: "Score",
    saveScore: "Save score",
    editableUntil: "Editable until {date}",
    notEditable: "Result locked",
    addPlayerToTeam: "Add player",
    saveTeams: "Save teams",
    backToGame: "Back to game",
    historyTitle: "{title} — History",

    // TeamPicker
    playerCount: "{n} player",
    playerCountPlural: "{n} players",
    dropPlayersHere: "Drop players here",

    // Recurrence descriptions
    everyWeek: "Every week",
    everyNWeeks: "Every {n} weeks",
    everyWeekOn: "Every week on {day}",
    everyNWeeksOn: "Every {n} weeks on {day}",
    everyMonth: "Every month",
    everyNMonths: "Every {n} months",

    // API errors
    errorTooManyEvents: "Too many events created. Try again in an hour.",
    errorTitleRequired: "Title is required.",
    errorLocationRequired: "Location is required.",
    errorDateRequired: "Date and time are required.",
    errorInvalidDate: "Invalid date/time.",
    errorPastDate: "Event must be in the future.",
    errorNotFound: "Not found.",
    errorPlayerNameRequired: "Player name is required.",
    errorPlayerDuplicate: '"{name}" is already in the list.',
    errorNeedMorePlayers: "Need at least 2 players.",

    // Notifications
    notifySubscribe: "Get notified",
    notifyUnsubscribe: "Turn off notifications",
    notifyEnabled: "Notifications on",
    notifyDenied: "Notifications blocked — check browser settings",
    notifyUnsupported: "Notifications not supported in this browser",
    notifyPlayerJoined: "{name} joined the game",
    notifyPlayerLeft: "{name} left the game",
    notifyPlayerLeftBench: "{name} left the bench",
    notifyPlayerLeftPromoted: "{left} left · {promoted} is now playing",
    notifyPlayerJoinedBench: "{name} joined the bench",
    notifyPlayerPromoted: "{name} was promoted from the bench",
    notifyGameFull: "Game is full",
    notifySpotsLeft: "{n} spot(s) left",

    // Update banner
    updateAvailable: "A new version is available",
    updateNow: "Update",

    // Webhooks / Integrations
    integrations: "Integrations",
    webhookEndpoint: "Webhook endpoint",
    webhookCopied: "Copied!",
    webhookHelp: "POST to this URL to register a webhook. See docs for payload format.",

    // ELO / Ratings
    balancedTeams: "Balanced",
    balancedTeamsTooltip: "Use ELO ratings to balance teams",
    ratings: "Ratings",
    rating: "Rating",
    gamesPlayed: "Games",
    wins: "W",
    draws: "D",
    losses: "L",
    eloChange: "{delta}",
    noRatings: "No ratings yet. Play some games and record scores to build rankings.",
    recalculateRatings: "Recalculate",
    recalculating: "Recalculating…",
    ratingsRecalculated: "Ratings recalculated ({n} games processed)",

    // Public events
    publicGames: "Public Games",
    publicGamesSubtitle: "Open games looking for players. Join one or create your own!",
    noPublicGames: "No public games available right now.",
    noPublicGamesDesc: "Create a game and make it public so others can find it.",
    makePublic: "Public",
    makePublicTooltip: "Make this game visible on the public games page",
    joinGame: "Join",

    // Docs
    docs: "Docs",
  },
  pt: {
    // App
    appName: "Convocados",
    toggleDarkMode: "Alternar modo escuro",
    viewOnGithub: "Ver no GitHub",

    // CreateEventForm
    createGame: "Criar um Jogo",
    createGameSubtitle: "Configura o teu jogo de futebol e partilha o link com os teus jogadores.",
    gameTitle: "Título do jogo",
    gameTitlePlaceholder: "ex: Futebol 5 de terça",
    location: "Local",
    locationPlaceholder: "ex: Riverside Astro, Campo 2",
    locationOptional: "Local (opcional)",
    dateTime: "Data e hora",
    teamNames: "Nomes das equipas",
    team1Name: "Nome da equipa 1",
    team2Name: "Nome da equipa 2",
    recurrence: "Recorrência",
    recurringGame: "Jogo recorrente",
    every: "Cada",
    frequency: "Frequência",
    weeks: "semana(s)",
    months: "mês(es)",
    onDay: "No dia (opcional)",
    sameDayAsEvent: "Mesmo dia do evento",
    recurrenceInfo: "A lista de jogadores é reiniciada 1 hora após cada jogo. O link mantém-se.",
    creating: "A criar…",
    createGameBtn: "Criar jogo",
    somethingWentWrong: "Algo correu mal.",
    advancedOptions: "Opções avançadas",
    maxPlayers: "Máx. jogadores",
    maxPlayersHelper: "Jogadores acima deste limite vão para o banco",

    // Bench
    activePlayers: "A jogar ({n}/{max})",
    benchPlayers: "Banco ({n})",
    benchInfo: "Os jogadores no banco são promovidos automaticamente quando há uma vaga.",
    youAreOnBench: "Estás no banco — serás promovido se houver uma vaga.",
    youArePlaying: "Entraste como {name}",

    // Days
    monday: "Segunda-feira",
    tuesday: "Terça-feira",
    wednesday: "Quarta-feira",
    thursday: "Quinta-feira",
    friday: "Sexta-feira",
    saturday: "Sábado",
    sunday: "Domingo",

    // EventPage
    gameTime: "Hora do jogo!",
    gameNotFound: "Jogo não encontrado",
    gameNotFoundDesc: "Este link pode ser inválido ou ter expirado.",
    createNewGame: "Criar um novo jogo",
    recurringResetAlert: "Este jogo recorrente foi reiniciado para a próxima ocorrência em {date}. A lista de jogadores foi limpa.",
    copyLink: "Copiar link",
    players: "Jogadores",
    addPlayerPlaceholder: "Adicionar jogador",
    addPlayerHelper: "Prima Enter para adicionar, ou cola uma lista separada por linhas",
    randomizeTeams: "Sortear equipas",
    teamsOutOfSync: "Os jogadores mudaram desde o último sorteio. Considera sortear novamente.",
    teams: "Equipas",
    vs: "vs",
    rerandomizeTitle: "Sortear equipas novamente?",
    rerandomizeDesc: "As equipas já foram definidas. Sortear novamente irá substituir a distribuição atual.",
    cancel: "Cancelar",
    randomize: "Sortear",
    linkCopied: "Link copiado!",
    renameTeam: "Renomear {label}",

    // Share
    shareGame: "Partilhar com jogadores",
    shareGameMobile: "Partilhar",
    linkCopiedFull: "Link copiado!",

    // Quick join
    quickJoinTitle: "Entrar no jogo",
    quickJoinPlaceholder: "O teu nome",
    quickJoinBtn: "Entrar",
    quickJoinedAs: "Entraste como {name}",
    quickJoinLeave: "Sair",
    recentPlayers: "Jogadores recentes",
    showAllPlayers: "Ver todos",
    noSuggestions: "Escreve um novo nome",

    // History
    history: "Histórico",
    viewHistory: "Ver histórico",
    noHistory: "Ainda não há jogos anteriores.",
    noHistoryDesc: "O histórico é registado automaticamente após cada jogo recorrente.",
    statusPlayed: "Jogado",
    statusCancelled: "Cancelado",
    markPlayed: "Marcar como jogado",
    markCancelled: "Marcar como cancelado",
    score: "Resultado",
    saveScore: "Guardar resultado",
    editableUntil: "Editável até {date}",
    notEditable: "Resultado bloqueado",
    addPlayerToTeam: "Adicionar jogador",
    saveTeams: "Guardar equipas",
    backToGame: "Voltar ao jogo",
    historyTitle: "{title} — Histórico",

    // TeamPicker
    playerCount: "{n} jogador",
    playerCountPlural: "{n} jogadores",
    dropPlayersHere: "Arrasta jogadores aqui",

    // Recurrence descriptions
    everyWeek: "Todas as semanas",
    everyNWeeks: "De {n} em {n} semanas",
    everyWeekOn: "Todas as semanas à {day}",
    everyNWeeksOn: "De {n} em {n} semanas à {day}",
    everyMonth: "Todos os meses",
    everyNMonths: "De {n} em {n} meses",

    // API errors
    errorTooManyEvents: "Demasiados jogos criados. Tenta novamente dentro de uma hora.",
    errorTitleRequired: "O título é obrigatório.",
    errorLocationRequired: "O local é obrigatório.",
    errorDateRequired: "A data e hora são obrigatórias.",
    errorInvalidDate: "Data/hora inválida.",
    errorPastDate: "O jogo tem de ser no futuro.",
    errorNotFound: "Não encontrado.",
    errorPlayerNameRequired: "O nome do jogador é obrigatório.",
    errorPlayerDuplicate: '"{name}" já está na lista.',
    errorNeedMorePlayers: "São necessários pelo menos 2 jogadores.",

    // Notifications
    notifySubscribe: "Receber notificações",
    notifyUnsubscribe: "Desativar notificações",
    notifyEnabled: "Notificações ativas",
    notifyDenied: "Notificações bloqueadas — verifica as definições do browser",
    notifyUnsupported: "Notificações não suportadas neste browser",
    notifyPlayerJoined: "{name} entrou no jogo",
    notifyPlayerLeft: "{name} saiu do jogo",
    notifyPlayerLeftBench: "{name} saiu do banco",
    notifyPlayerLeftPromoted: "{left} saiu · {promoted} está agora a jogar",
    notifyPlayerJoinedBench: "{name} entrou para o banco",
    notifyPlayerPromoted: "{name} saiu do banco",
    notifyGameFull: "Jogo completo",
    notifySpotsLeft: "Faltam {n} jogador(es)",

    // Update banner
    updateAvailable: "Nova versão disponível",
    updateNow: "Atualizar",

    // Webhooks / Integrations
    integrations: "Integrações",
    webhookEndpoint: "Endpoint do webhook",
    webhookCopied: "Copiado!",
    webhookHelp: "Faz POST para este URL para registar um webhook. Consulta a documentação para o formato do payload.",

    // ELO / Ratings
    balancedTeams: "Equilibrado",
    balancedTeamsTooltip: "Usar classificações ELO para equilibrar equipas",
    ratings: "Classificações",
    rating: "Rating",
    gamesPlayed: "Jogos",
    wins: "V",
    draws: "E",
    losses: "D",
    eloChange: "{delta}",
    noRatings: "Ainda sem classificações. Joga alguns jogos e regista resultados para criar rankings.",
    recalculateRatings: "Recalcular",
    recalculating: "A recalcular…",
    ratingsRecalculated: "Classificações recalculadas ({n} jogos processados)",

    // Public events
    publicGames: "Jogos Públicos",
    publicGamesSubtitle: "Jogos abertos à procura de jogadores. Entra num ou cria o teu!",
    noPublicGames: "Não há jogos públicos de momento.",
    noPublicGamesDesc: "Cria um jogo e torna-o público para que outros o encontrem.",
    makePublic: "Público",
    makePublicTooltip: "Tornar este jogo visível na página de jogos públicos",
    joinGame: "Entrar",

    // Docs
    docs: "Docs",
  },
} as const;

export type Locale = keyof typeof translations;
export type TranslationKey = keyof typeof translations.en;

export type TFunction = (key: TranslationKey, params?: Record<string, string | number>) => string;

export function createT(locale: Locale): TFunction {
  return (key, params) => {
    const dict = translations[locale] as Record<string, string>;
    let str = dict[key] ?? (translations.en as Record<string, string>)[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replaceAll(`{${k}}`, String(v));
      }
    }
    return str;
  };
}

export function detectLocale(): Locale {
  if (typeof navigator === "undefined") return "en";
  return navigator.language.toLowerCase().startsWith("pt") ? "pt" : "en";
}
