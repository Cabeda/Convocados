// Funny, engaging random game titles per locale.
// Each title works as a standalone event name that makes people smile.

const titles = {
  en: [
    // Epic & dramatic
    "The Battle of the Legends",
    "Clash of the Titans",
    "The Great Showdown",
    "War of the Benchwarmers",
    "Return of the Champions",
    "The Final Countdown",
    "Rise of the Underdogs",
    "Revenge of the Subs",

    // Funny & casual
    "Legs Will Be Sore Tomorrow",
    "No Slide Tackles Please",
    "Who Forgot the Bibs?",
    "The One Where Nobody Defends",
    "Cardio Disguised as Fun",
    "Excuses & Exercise",
    "Sweat Now, Beer Later",
    "The Beautiful Disaster",
    "Controlled Chaos FC",
    "Sunday League Legends",
    "Midweek Madness",
    "The Usual Suspects",
    "Goals & Bad Decisions",
    "Hamstring Roulette",
    "Last One Standing",
    "The Rematch Nobody Asked For",

    // Time-based
    "Tuesday Night Lights",
    "Friday Night Fever",
    "Weekend Warriors",
    "The Monday Cure",
    "Hump Day Hustle",
    "Saturday Showtime",
    "The After-Work Special",
    "Lunchtime Legends",
  ],
  pt: [
    // Épico & dramático
    "A Batalha das Lendas",
    "Choque dos Titãs",
    "O Grande Confronto",
    "A Vingança dos Suplentes",
    "O Regresso dos Campeões",
    "A Contagem Final",
    "A Ascensão dos Underdogs",
    "A Revolta do Banco",

    // Engraçado & casual
    "Amanhã Ninguém Anda",
    "Sem Carrinho Por Favor",
    "Quem Trouxe os Coletes?",
    "Ninguém Defende Aqui",
    "Cardio Disfarçado de Jogo",
    "Desculpas & Exercício",
    "Suar Agora, Cerveja Depois",
    "O Belo Desastre",
    "Caos Controlado FC",
    "Lendas de Domingo",
    "Loucura a Meio da Semana",
    "Os Suspeitos do Costume",
    "Golos & Más Decisões",
    "Roleta de Lesões",
    "O Último de Pé",
    "A Revanche Que Ninguém Pediu",

    // Baseado no tempo
    "Noite de Terça Épica",
    "Febre de Sexta à Noite",
    "Guerreiros de Fim de Semana",
    "A Cura da Segunda-feira",
    "Correria de Quarta",
    "Sábado em Grande",
    "O Especial Pós-Trabalho",
    "Lendas da Hora de Almoço",
  ],
} as const;

export type TitleLocale = keyof typeof titles;

export function getRandomTitle(locale: TitleLocale): string {
  const pool = titles[locale] ?? titles.en;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function getRandomTitles(locale: TitleLocale, count: number): string[] {
  const pool = [...(titles[locale] ?? titles.en)];
  const result: string[] = [];
  for (let i = 0; i < Math.min(count, pool.length); i++) {
    const idx = Math.floor(Math.random() * pool.length);
    result.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return result;
}
