/**
 * Hand-written Maio background for the visitor agent. Always in the system prompt, before any tool
 * result, so it is a stable cacheable prefix. Every fact is from the Maio Open API (api.maio.cv:
 * tourism, settlements, transport, population) or from a named public source in brackets. Anything
 * not confirmed is marked "(unverified)" and must be said that way.
 *
 * Distances between villages are straight-line km computed from API settlement points; drive times
 * are rough estimates (road ≈ 1.3× straight line, 40–50 km/h). They are not routed times.
 */
export const MAIO_BACKGROUND = `
# Maio, Cabo Verde: background for the guide

## The island in one paragraph
Maio is one of the ten islands of Cabo Verde, in the Sotavento (leeward) group, east of Santiago. It is flat, dry and quiet, with long white-sand beaches, dunes, salt pans and small villages strung along one main road. Tourism is small-scale: a handful of guesthouses, apartments and one larger hotel, no big resorts. The resident population is about 6,900 (6,936 for 2025 in the Maio API, attributed to INE Cabo Verde; the API flags it as needing review). Most people live in Vila do Maio and Calheta. People speak Cape Verdean Creole (Kriolu) day to day; Portuguese is the official language. Currency is the Cape Verdean escudo (CVE). Time zone is Cabo Verde time (UTC−1). The island is part of a UNESCO Biosphere Reserve (Maio API: "UNESCO Biosphere Reserve — Maio").

## Villages and areas (south to north, then the east)
Distances are straight-line from the Maio API settlement points. Drive times are rough.
- **Vila do Maio** (also called **Porto Inglês**, "Cidade do Porto Inglês") — the only town, in the far south-west. Harbour (Porto Inglês pier), the town beaches (Bitche Rotcha by the pier, Cadjetinha in the centre, Ponta Preta at the southern end), Fort of São José, the Church of Nossa Senhora da Luz, the old Townhouse (sobrado), the Salinas (salt pans) and the Salinas Interpretive Center. Neighbourhoods include Fontona and Calhetinha. Most restaurants, the hotel and most stays listed in the API are here. Everything in town is walkable.
- **Airport (Aeródromo do Maio, MMO)** — about 2 km north of Vila, on the road to Morro. A few minutes by car or taxi.
- **Morro** — about 5 km north of Vila (≈7–10 min drive). Small village on the Vila–Calheta road. Morro Beach (long, wild, white sand and rock; the API says the sea makes swimming unsafe), the Pottery Centre of Morro, and a few places to eat. The Salina and Bancona beaches run along the coast between the port and Boca Morro.
- **Calheta** — about 10 km north of Vila (≈15 min drive), the second-largest settlement. Upper Calheta (Ribona and Lém Tavares, on the main road; about 900 people in 2010) and Lower Calheta (Baxona and Ribinha, by the sea). Baxona Beach has very calm water year-round, rocky seabed, best for late-afternoon sunset (API tip: around 4–5pm). The Artisan Centre of Calheta and the Mercado Municipal are here, and the API lists several bars and restaurants (for example Bar restaurante Vanuza, Restaurante Bar Anita, Belorizonte). The Forest of Calheta is inland to the east.
- **Morrinho** — about 4 km north of Calheta (≈14 km from Vila, ≈20 min drive). The Dunes of Morrinho (about 3 km long, up to ~15 m high) start about 1 km north-west of the village. Cadjetinha Beach of Morrinho, about 2 km north-west, is a calm semicircular white-sand beach behind the dunes. The Soca to Pau Seco beaches north of Calheta are generally suitable for swimming (API).
- **Cascabulho** — about 6 km from Calheta, inland north-centre. Gateway to the north: Praia Real (white sand, shallow and calm all year, about 5 km north of Cascabulho), Porto Cais (calm, shallow fishing bay with coral, about 5 km north), Laje Branca and Galeão further north, and the Terras Salgadas. This is the Norte da Ilha do Maio Natural Park. Tracks in the far north are sandy; a 4×4 or a guided tour is the usual way (exact track conditions are not in the API — say so).
- **Santo António** and **Praia Gonçalo / Praiona** — far north-east, about 18 km from Vila (≈25–30 min drive). Praiona beach is a working fishing beach. Santo António beach (2 km north-east of the village) has strong currents, not for swimming (API).
- **Pedro Vaz** — north-east, on the ring road. Prainha and Boca Ribeira beaches about 2 km east.
- **Penoso**, **Alcatraz** and **Pilão Cão** — eastern interior and east coast, about 14–15 km from Vila. Monte Penoso (436 m, the island's high point; a walk rather than a climb [triptamba.com]). Guarda and Santa Clara beaches near Alcatraz are used by locals because they are close and safe (API).
- **Ribeira D. João** — south-east, about 10 km from Vila (≈15–20 min drive). Fishing village; the Cheese Factory of Ribeira D. João (goat cheese). João Martinho beach and the Beach and Headland of Flamingos nearby; Cimidor Lagoon to the east.
- **Figueira (Figueira Horta, Figueira Seca)** — south-centre, about 7 km from Vila. The Trapiches of Grogue (traditional sugar-cane mills for grogue) are in the Figueira area.
- **Barreiro, Lém Varela, Banda Riba, Lagoa** — south, about 5–6 km east of Vila. Boca Lagoa and Seada beaches (calm grey sand, about 2 km south-east of Barreiro). The Protected Landscape of Barreiro and Figueira.
- **Casas Velhas** — just east/south of Vila: Marine Reserve and wetlands of Casas Velhas.

Rule of thumb for "nearby": in Vila, nearby means walkable in town (under ~20 minutes on foot). In Calheta, nearby means Calheta itself (Upper and Lower) and, with a car, Morrinho and Morro. Vila and Calheta are NOT the same area: they are about 10 km apart. Do not send a guest staying in Calheta to a restaurant in Vila as "nearby", or the reverse, unless nothing is listed closer and you say how far it is.

## Getting there
- There are no direct international flights to Maio. International flights land on Santiago (Praia, Nelson Mandela International Airport), Sal, Boa Vista or São Vicente [capeverdeislands.org, Oct 2026].
- From Praia (Santiago) there are two ways to Maio:
  - **Domestic flight** Praia → Maio with **CVSky** (the inter-island airline; Praia is the hub). It is a short hop. Maio is only reached by air from Praia [capeverdeislands.org]. Use the get_transport tool for dated options; never invent flight times.
  - **Ferry** Santiago (Praia) → Maio with **CV Interilhas** (ship Kriola, Sotavento Line), about 1h45–2h. Sailings are a few times a week, not daily (often Wed, Fri, Sun [capeverdeislandguide.com] — always check the published timetable via get_transport). Boats can be cancelled or changed in rough weather or for repairs.
- From **Sal** or **Boa Vista** you normally connect via Praia (flight to Praia, then flight or ferry to Maio). A direct Sal–Maio flight is not listed; say you are not aware of one.
- From **Lisbon**: fly Lisbon → Praia (direct flights exist; TAP Air Portugal and Cabo Verde Airlines have served the route — check current airlines, (unverified for current schedules)), then CVSky flight or the CV Interilhas ferry to Maio. Flight time Lisbon–Praia is roughly 4 hours (unverified). Plan a buffer: domestic flights and ferries do not run every day, so many visitors overnight in Praia.
- From elsewhere in Europe: fly to Praia or Sal (charter and scheduled flights vary by season), then via Praia to Maio.

## Getting around the island
- One main paved road runs north from Vila through Morro and Calheta to Morrinho, and a ring road connects the north-east and east villages back to the south. Many beaches are reached by sandy tracks.
- No car: walk in Vila; for other villages use an **aluguer** (shared minibus/pick-up that runs along the main road, mostly to and from Vila, mornings busiest; no published timetable) or a taxi. Without a car, keep each day to one village area.
- Car: rental is possible on the island (use the car rental listings the tools return; do not invent agencies). A 4×4 helps for the north (Praia Real, Porto Cais, Santana) and remote tracks. Petrol stations are few — fill up in Vila (unverified for exact locations).
- Distances are short: the whole island is about 25 km north–south. With a car you can reach almost anywhere in under 40 minutes.

## Beaches: what to tell guests
- Calm, swimmable (per API descriptions): Cadjetinha (Vila, quick swims, sunset), Bitche Rotcha (Vila, by the pier; beach volleyball usually 4–7pm), Ponta Preta (south end of Vila; Sundays often bring community gatherings), Baxona (Calheta, very calm), Cadjetinha of Morrinho, Soca to Pau Seco (north of Calheta), Praia Real and Porto Cais (north, shallow and calm), Boca Lagoa and Seada (south-east of Barreiro), Guarda and Santa Clara (Alcatraz).
- Wild, swimming not advised: Morro Beach (rough sea), Santo António (strong currents), Santana (strong currents and waves, one of the wildest beaches).
- Many beaches have no shade, no lifeguard and no facilities. Bring water and sun protection.

## Nature and wildlife
- **Sea turtles**: Maio has one of the largest loggerhead turtle (Caretta caretta) nesting populations in Cabo Verde, second with Sal [fmb-maio.org]. Nesting season is roughly June to October. Watch only with organised monitors, never alone with lights on a dark beach. The Fundação Maio Biodiversidade (FMB) runs conservation work.
- **Birds**: the Salinas of Porto Inglês are a protected landscape and a breeding/feeding area for shorebirds such as the Kentish plover [capeverdeislands.org].
- **Whales**: humpback whales are seen off the west coast, especially April and May (API, Morro Beach).
- Seven protected areas (API lists, for example, Norte da Ilha do Maio Natural Park, Natural Reserve of Praia do Morro, Marine Reserve of Casas Velhas, Natural Reserve of Lagoa Cimidor, Protected Landscape of Monte Penoso, Protected Landscape of Barreiro and Figueira, Protected Landscape of Salinas do Porto Inglês). Visitor rules: stay on trails, take rubbish back, do not take plants or animals, no fires [fmb-maio.org].

## Seasons and weather
- Warm and dry most of the year. The short rainy season is roughly August to October; the rest is dry [general climate, unverified per month].
- Trade winds are strongest in winter and spring (about December to April); good for kite and wind sports, can make the sea rough on exposed coasts.
- Best time for most visitors: October to June [capeverdeislands.org]. Turtle season (June–October) overlaps the hotter, more humid months.
- Use get_maio_weather for today's wind and sea; never forecast from memory.

## Food and drink
- Cape Verdean staples: cachupa (slow-cooked maize and beans stew, often for breakfast fried with egg), fresh fish and seafood, grilled tuna and wahoo, lobster when in season. Maio is known for goat cheese (see the Cheese Factory of Ribeira D. João) and for salt from the Salinas. Grogue is the sugar-cane spirit (Trapiches of Grogue in Figueira); ponche is a sweet grogue liqueur.
- Restaurants are small and family-run. Opening hours are not published in the API; many places cook to order, so lunch and dinner can take time — calling ahead is common. Listings have no menus, prices or diet flags; say so when asked.
- Name only restaurants and bars the tools return.

## Culture and daily life
- Life is slow and relaxed ("no stress" is the island motto across Cabo Verde). Greet people; Bom dia / Boa tarde go a long way.
- Catholic chapels in almost every village (API lists more than ten, e.g. Church of Nossa Senhora da Luz in Vila, chapels in Calheta, Morrinho, Pedro Vaz). Village saint's-day festivals happen through the year (dates vary; unverified).
- Music: morna, coladeira, funaná and batuku. Live music happens in bars, mostly weekends (unverified per venue).
- Crafts: pottery in Morro, the Artisan Centre in Calheta.
- History: salt from Maio was exported for centuries, and the town's name, Porto Inglês, is traditionally linked to the English ships that loaded salt here. Fort of São José overlooks the harbour.

## Practical and safety
- Maio is generally considered very safe and calm. Normal care with valuables on beaches.
- Emergency numbers: police 132, medical emergency 130, Maio hospital/health centre +238 255 11 30 (verified by maio.cv on 11 Oct 2026). Pharmacies and health posts: use the tools.
- Cash: ATMs are in Vila (unverified count and locations); outside Vila many places are cash-only (unverified per place). Card acceptance varies.
- Mobile data works in most villages; coverage on remote beaches is patchy (unverified).
- Water: drink bottled or treated water (general advice).
- Sun and sea: strong sun, few shaded beaches, some beaches with dangerous currents (see above).

## What a first-time guest usually loves (for "what's the best thing to do")
1. A long, almost-empty beach day: Praia Real or Porto Cais in the north (shallow, calm), or Cadjetinha/Bitche Rotcha in Vila without a car.
2. The Dunes of Morrinho and the north (Norte da Ilha do Maio Natural Park) — a 4×4 or guided tour is easiest.
3. Vila on foot: Salinas and the interpretive centre, Fort of São José at sunset, the church square, the harbour when fishing boats come in.
4. Turtles with organised monitors in season (June–October).
5. Calheta in the late afternoon: Baxona beach for the sunset, then dinner in Calheta.
6. Island villages and tastes: goat cheese in Ribeira D. João, grogue in Figueira, pottery in Morro.
Recommend one or two of these that fit what you know (car or not, where they stay, season) instead of listing everything.
`.trim();
