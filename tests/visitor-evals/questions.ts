/**
 * Realistic visitor questions for the Maio guide. `area` = the guest's village (zone id from
 * lib/visitor/geo.ts): every place card must be in that area or its neighbours, never in `notArea`.
 * `history` = earlier user turns (assistant replies are filled by the runner).
 */
export type VisitorCase = {
  id: string;
  q: string;
  locale?: "en" | "pt" | "fr";
  history?: string[];
  area?: string;
  notArea?: string[];
  /** The reply must mention this (e.g. the actual answer topic). */
  mention?: RegExp;
  /** Open questions: must not start a plan or ask for trip details first. */
  open?: boolean;
  /** Nothing in the Maio listings fits: the reply must label an outside source or say honestly it has nothing. */
  fallback?: boolean;
  /** The reply must not match this (on top of the leak checks every case gets). */
  forbid?: RegExp;
};

const near = (id: string, q: string, area: string, notArea: string[], extra: Partial<VisitorCase> = {}): VisitorCase => ({ id, q, area, notArea, ...extra });

export const VISITOR_CASES: VisitorCase[] = [
  // Open questions
  { id: "best-thing", q: "What's the best thing to do in Maio?", open: true },
  { id: "first-time", q: "First time in Maio, what should I not miss?", open: true },
  { id: "why-maio", q: "Why should I visit Maio instead of Sal?", open: true },
  { id: "one-day", q: "If I only have one free afternoon, what would you do?", open: true },
  { id: "kids", q: "Is Maio good for kids?", open: true },
  { id: "couple", q: "What's romantic to do in Maio for a couple?", open: true },
  { id: "rainy", q: "What can we do on a windy day?", open: true },
  { id: "nature", q: "What nature is there to see on Maio?", open: true },
  { id: "culture", q: "Tell me about the culture in Maio", open: true, mention: /music|morna|funan|batuk|creole|kriol|chapel|church|festiv/i },
  { id: "music", q: "Where can I hear local music?", open: true },
  { id: "pt-best", q: "O que é imperdível no Maio?", locale: "pt", open: true },
  { id: "fr-best", q: "Qu'est-ce qu'il faut absolument faire à Maio ?", locale: "fr", open: true },
  { id: "hidden-gem", q: "Any hidden gems on the island?", open: true },
  { id: "sunset-spot", q: "Where is the best place to watch the sunset?", open: true },
  { id: "photography", q: "Best spots for photography?", open: true },

  // Getting there
  { id: "from-lisbon", q: "How do I get to Maio from Lisbon?", mention: /praia/i },
  { id: "from-sal", q: "We land in Sal. How do we get to Maio?", mention: /praia/i },
  { id: "ferry-or-flight", q: "Is it better to take the ferry or fly from Praia to Maio?", mention: /ferry|flight|fly|boat|cvsky|interilhas/i },
  { id: "ferry-length", q: "How long is the ferry from Praia to Maio?", mention: /hour|h\b|2|1h45|minutes/i },
  { id: "direct-flights", q: "Are there direct international flights to Maio?", mention: /no|praia|not/i },
  { id: "from-london", q: "Coming from London, what's the easiest way to Maio?", mention: /praia|sal/i },
  { id: "pt-lisboa", q: "Como chego ao Maio a partir de Lisboa?", locale: "pt", mention: /praia/i },
  { id: "fr-paris", q: "Comment aller à Maio depuis Paris ?", locale: "fr", mention: /praia/i },
  { id: "airport-town", q: "How far is the airport from Vila do Maio?", mention: /km|min/i },
  { id: "overnight-praia", q: "Do I need to stay a night in Praia?", mention: /praia/i },

  // Getting around / car
  { id: "need-car", q: "Do I need a car on Maio?", mention: /car|aluguer|taxi/i },
  { id: "no-car", q: "We don't have a car, how do we get around?", mention: /aluguer|taxi|walk/i },
  { id: "aluguer", q: "What is an aluguer?", mention: /shared|minibus|van|pick/i },
  { id: "taxi-calheta", q: "How do I get from Vila to Calheta without a car?", mention: /aluguer|taxi/i },
  { id: "drive-time", q: "How long does it take to drive from Vila to Morrinho?", mention: /min/i },
  { id: "bike", q: "Can I cycle around the island?", open: true },
  { id: "walk-town", q: "Is Vila do Maio walkable?", mention: /walk/i },

  // Food near X
  near("eat-calheta", "Where to eat near Calheta?", "calheta", ["vila"]),
  near("eat-vila", "Where can I eat in Vila do Maio?", "vila", ["calheta", "morro"]),
  near("eat-morro", "Any restaurant in Morro?", "morro", ["calheta"]),
  near("eat-baxona", "We're at Baxona beach, where can we grab lunch nearby?", "calheta", ["vila"]),
  near("dinner-calheta-nocar", "Staying in Calheta with no car, where can we have dinner?", "calheta", ["vila", "morro"]),
  near("seafood-calheta", "Best seafood around Calheta?", "calheta", ["vila"]),
  near("eat-vila-walk", "Somewhere to eat I can walk to from Hotel Big Game Maio?", "vila", ["calheta", "morro"]),
  near("bar-calheta", "Is there a bar in Calheta for a drink?", "calheta", ["vila"]),
  near("eat-casa-do-mar", "We're staying at Casa do Mar, where should we eat tonight?", "calheta", ["vila"]),
  near("eat-morro-villa", "Staying at Villa Maris Eco Village, any food close by?", "morro", ["calheta"]),
  near("pt-comer-calheta", "Onde comer perto da Calheta?", "calheta", ["vila"], { locale: "pt" }),
  near("fr-manger-vila", "Où manger à Vila do Maio ?", "vila", ["calheta"], { locale: "fr" }),
  near("breakfast-vila", "Where can I get breakfast in town?", "vila", ["calheta"]),
  near("pizza", "Is there pizza in Vila?", "vila", ["calheta"]),
  near("eat-ctx-calheta", "Where can we eat?", "calheta", ["vila"], { history: ["We're staying in Calheta."] }),
  near("eat-ctx-morro", "Any lunch place nearby?", "morro", ["calheta"], { history: ["We're in Morro today, no car."] }),
  near("drinks-vila", "Where can we get a drink in the evening in Vila?", "vila", ["calheta"]),
  near("groceries-calheta", "Where can I buy groceries near Calheta?", "calheta", ["vila"]),
  near("groceries-morro", "Is there a supermarket in Morro?", "morro", []),
  near("local-food-vila", "Where can I try local food like cachupa in Vila?", "vila", ["calheta"]),

  // Beaches near X
  near("beach-vila-nocar", "Which beach can I walk to from Vila do Maio? No car.", "vila", ["calheta", "morrinho", "cascabulho"]),
  near("beach-calheta", "Best beach near Calheta?", "calheta", ["vila"]),
  near("beach-morro-walk", "I'm staying in Morro and don't have a car, which beach can I walk to?", "morro", ["calheta", "cascabulho"]),
  near("beach-morrinho", "Beaches near Morrinho?", "morrinho", ["vila"]),
  near("swim-calheta", "Where can the kids swim safely near Calheta?", "calheta", ["vila"]),
  near("beach-ctx-vila", "And a beach close by?", "vila", ["calheta", "cascabulho"], { history: ["We're staying at Hotel Big Game Maio."] }),
  { id: "calm-beach", q: "Which beaches are calm for swimming?", mention: /calm|swim/i },
  { id: "wild-beach", q: "Which beaches are dangerous for swimming?", mention: /current|rough|not/i },
  { id: "best-beach", q: "What's the most beautiful beach on Maio?", open: true, forbid: /most (?:visitors|people)|widely considered/i },
  { id: "best-restaurant", q: "What is the best restaurant on the island?", open: true, forbid: /most (?:visitors|people|locals)|widely considered|everyone says/i },
  { id: "praia-real", q: "How do I get to Praia Real?", mention: /cascabulho|north|4|track|car/i },
  { id: "pt-praia-vila", q: "Que praia posso ir a pé na Vila?", locale: "pt", area: "vila", notArea: ["calheta"] },
  { id: "fr-plage-calheta", q: "Quelle plage près de Calheta ?", locale: "fr", area: "calheta", notArea: ["vila"] },
  { id: "snorkel", q: "Where can I snorkel?", open: true },
  { id: "surf", q: "Can I surf in Maio?", open: true },
  { id: "kite", q: "Is there kitesurfing on Maio?", open: true },

  // Sights / nature / activities
  near("see-vila", "What can I see in Vila do Maio on foot?", "vila", ["calheta", "morrinho"]),
  near("see-calheta", "Anything to see around Calheta?", "calheta", ["vila"]),
  { id: "dunes", q: "Where are the dunes?", mention: /morrinho/i },
  { id: "salinas", q: "Can I visit the salt pans?", mention: /salin|salt/i },
  { id: "turtles", q: "When can I see turtles?", mention: /june|jul|aug|sep|oct|season/i },
  { id: "turtles-how", q: "How do I see turtles nesting responsibly?", mention: /guide|monitor|fmb|foundation|light/i },
  { id: "whales", q: "Can I see whales from Maio?", mention: /april|may|humpback/i },
  { id: "hike", q: "Is there any hiking on Maio?", mention: /penoso|monte|mount|trail|walk/i },
  { id: "highest", q: "What's the highest point on the island?", mention: /penoso/i },
  { id: "cheese", q: "Where can I try goat cheese?", mention: /ribeira d|cheese/i },
  { id: "grogue", q: "Where is grogue made on Maio?", mention: /figueira|trapiche/i },
  { id: "pottery", q: "Where can I buy local crafts?", mention: /morro|calheta|artisan|pottery/i },
  { id: "tours", q: "Are there any guided tours?", open: true, forbid: /\b(?:ask|visit|try|at|go to) (?:at )?the tourist (?:office|information)/i },
  { id: "tours-book", q: "Where do I book an island tour, is there a tourist office?", open: true, forbid: /\b(?:the|a) tourist office (?:in|at|on|by)\b/i },
  { id: "boat-trip", q: "Can we do a boat trip or fishing?", open: true, forbid: /location not listed|\(listed\)|listed as/i },
  { id: "fishing-where", q: "Where does the sport fishing boat leave from?", open: true, forbid: /location not listed|listed as/i },
  { id: "jetski", q: "Is there jet ski?", open: true },
  { id: "fort", q: "Tell me about the Fort of São José", mention: /fort|harbour|porto|vila/i },
  { id: "church", q: "Is there a church in Vila?", mention: /nossa senhora da luz|church/i },
  { id: "north-trip", q: "Is it worth going to the north of the island?", open: true },

  // Stays
  { id: "stay-quiet", q: "Where should I stay if I want somewhere quiet?", open: true },
  { id: "stay-calheta", q: "Are there places to stay in Calheta?", area: "calheta", notArea: ["vila"] },
  { id: "stay-vs", q: "Is it better to stay in Vila or Calheta?", mention: /vila|calheta/i },

  // Practical / seasons / safety
  { id: "best-time", q: "When is the best time to visit Maio?", mention: /oct|jun|dry|season|month/i },
  { id: "december", q: "What's the weather like in December?", mention: /wind|dry|warm/i },
  { id: "rainy-season", q: "When is the rainy season?", mention: /aug|sep|oct/i },
  { id: "safe", q: "Is Maio safe for tourists?", mention: /safe/i },
  { id: "currency", q: "What currency do they use and can I pay by card?", mention: /escudo|cve/i },
  { id: "atm", q: "Is there an ATM on the island?", mention: /vila|atm/i },
  { id: "language", q: "What language do people speak?", mention: /creole|kriol|portug/i },
  { id: "water", q: "Can I drink the tap water?", mention: /bottled|water/i },
  { id: "time-zone", q: "What time zone is Maio in?", mention: /utc|gmt|-1|−1/i },
  { id: "wifi", q: "Is there mobile internet?", open: true },
  { id: "pt-seguro", q: "O Maio é seguro?", locale: "pt", mention: /segur/i },
  { id: "fr-saison", q: "Quelle est la meilleure saison pour venir ?", locale: "fr", mention: /oct|juin|saison|sec/i },
  { id: "today-weather", q: "How is the sea today?", mention: /wave|sea|wind|m\b/i },

  // Step 2: trip state. What the guest said earlier (stay, village, party, dates, car, places shown) still holds turns later.
  near("state-stay-food", "Where can we eat nearby?", "calheta", ["vila", "morro"], { history: ["We're staying at Casa do Mar."] }),
  near("state-village-later", "Which beach can we walk to?", "morro", ["vila", "calheta"], { history: ["We're staying in Morro.", "What's the weather like this week?", "Is the water warm enough to swim?"], mention: /morro/i }),
  near("state-stay-later", "Where should we have dinner tonight?", "calheta", ["vila", "morro"], { history: ["We booked Casa do Mar for the week.", "Is Maio safe?", "Do people speak English?", "Is there an ATM?"] }),
  near("state-switch", "Where can we get dinner close by?", "calheta", ["vila"], { history: ["We're staying in Vila do Maio.", "Actually we moved to Calheta today."] }),
  near("state-pt-stay", "Onde podemos jantar perto?", "calheta", ["vila"], { locale: "pt", history: ["Estamos hospedados em Calheta."] }),
  { id: "state-nocar", q: "Which beach should we go to tomorrow?", history: ["We won't have a car on Maio."], mention: /walk|foot|taxi|aluguer|minutes?/i, forbid: /\b(?:will|do|would) you (?:have|rent|hire) a car\b/i },
  { id: "state-nocar-far", q: "How do we get to Praia Real?", history: ["No car for us this trip.", "What's the best beach?"], mention: /taxi|aluguer|guide|tour|driver|transfer/i, forbid: /\b(?:will|do|would) you (?:have|rent|hire) a car\b|\bdrive (?:north|there|up)\b/i },
  { id: "state-car-correction", q: "Is Praia Real worth the trip?", history: ["We'll have a car.", "Actually we decided not to rent a car."], mention: /taxi|aluguer|guide|tour|driver|without a car|no car/i, forbid: /\b(?:your|the) car\b|\byou can drive\b/i },
  { id: "state-kids", q: "Which beach is best for us?", history: ["We're two adults and a 4-year-old."], mention: /calm|shallow|kid|child|little one|toddler|4-year|family/i, forbid: /who is coming|how old|how many (?:people|of you)/i },
  { id: "state-dates-turtles", q: "Will we see turtles?", history: ["We arrive on 12 December for 5 days."], mention: /\b(?:june|july|august|september|october|jun|jul|aug|sep|oct)\b|outside (?:the )?(?:nesting )?season|not (?:in|during) december/i, forbid: /\bi can check\b|when (?:do|are) you (?:arrive|arriving|coming|visiting)|which dates|what dates/i },
  { id: "state-dates-whales", q: "Any chance of whales while we're there?", history: ["We're coming in March for a week."], mention: /whale|humpback|season|march|spring|feb|apr|may/i, forbid: /when (?:do|are) you (?:arrive|arriving|coming|visiting)|which dates|what dates/i },
  { id: "state-shown", q: "Which of those is closest to Baxona beach?", history: ["Where can I eat in Calheta?"], mention: /vanuza|anita|belorizonte|cala grande/i },
  // Distances from the stay, not the centre of its village (Belorizonte is ~2 min from Casa do Mar, ~11 from Calheta's centre).
  { id: "state-origin", q: "Any restaurant near Calheta?", history: ["We're staying at Casa do Mar."], mention: /belorizonte|vanuza|anita|cala grande/i, forbid: /belorizonte[^.;]{0,40}\b1[01]\s*(?:min|-minute)/i },

  // Step 3: nothing in the Maio listings fits. The guide may look further (Google Maps, then the web) and must label it, or say honestly it has nothing.
  { id: "fb-dentist", q: "Is there a dentist on Maio?", fallback: true },
  { id: "fb-yoga", q: "Where can I do a yoga class?", fallback: true },
  { id: "fb-laundry", q: "Where can I get laundry done?", fallback: true },

  { id: "fb-gym", q: "Is there a gym on the island?", fallback: true },
  { id: "fb-pt-dentista", q: "Há algum dentista no Maio?", locale: "pt", fallback: true },
  { id: "fb-fr-yoga", q: "Où peut-on faire du yoga à Maio ?", locale: "fr", fallback: true },
  // Listed things never go to an outside source.
  { id: "fb-listed-car", q: "Where can I rent a car?", mention: /rent|car|aluguer/i, forbid: /google maps|\bsource:/i },
  // The Maio API lists a barber (category hairdresser): it must be found, not sent to Google.
  { id: "fb-listed-hairdresser", q: "Is there a hairdresser on Maio?", mention: /barbearia dad/i, forbid: /google maps|\bsource:/i },
  { id: "fb-listed-fish", q: "Where can we eat fish in Calheta?", area: "calheta", mention: /vanuza|anita|belorizonte|cala grande/i, forbid: /google maps|\bsource:/i },
];
