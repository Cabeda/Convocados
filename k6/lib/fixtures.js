/**
 * Test data generators for k6 load tests.
 */

const firstNames = [
  "João", "Miguel", "Pedro", "Rui", "André", "Tiago", "Bruno", "Carlos",
  "Daniel", "Filipe", "Gonçalo", "Hugo", "Luís", "Marco", "Nuno", "Paulo",
  "Ricardo", "Sérgio", "Tomás", "Vasco", "Ana", "Beatriz", "Catarina",
  "Diana", "Eva", "Francisca", "Inês", "Joana", "Leonor", "Marta",
];

const lastNames = [
  "Silva", "Santos", "Ferreira", "Pereira", "Oliveira", "Costa", "Rodrigues",
  "Martins", "Sousa", "Fernandes", "Gonçalves", "Gomes", "Lopes", "Marques",
  "Alves", "Almeida", "Ribeiro", "Pinto", "Carvalho", "Teixeira",
];

const locations = [
  "Campo do Sporting, Lisboa",
  "Estádio da Luz, Lisboa",
  "Pavilhão Atlântico, Lisboa",
  "Campo Municipal, Porto",
  "Complexo Desportivo, Braga",
  "Pavilhão Rosa Mota, Porto",
  "Campo Sintético, Coimbra",
  "Estádio Algarve, Faro",
];

const sports = [
  "football-5v5",
  "football-7v7",
  "football-11v11",
  "futsal",
  "basketball",
  "volleyball",
  "padel",
];

/**
 * Generate a random player name.
 */
export function randomPlayerName(vuId, iter) {
  const first = firstNames[vuId % firstNames.length];
  const last = lastNames[iter % lastNames.length];
  return `${first} ${last} ${vuId}-${iter}`;
}

/**
 * Generate a random event creation payload.
 */
export function randomEventPayload(vuId) {
  const now = new Date();
  // Schedule event 1-30 days in the future
  const futureMs = now.getTime() + (1 + Math.floor(Math.random() * 30)) * 86400000;
  const dateTime = new Date(futureMs).toISOString();

  return {
    title: `Load Test Game ${vuId}-${Date.now()}`,
    location: locations[Math.floor(Math.random() * locations.length)],
    dateTime,
    maxPlayers: 10,
    sport: sports[Math.floor(Math.random() * sports.length)],
    isPublic: true,
    teamOneName: "Team A",
    teamTwoName: "Team B",
  };
}
