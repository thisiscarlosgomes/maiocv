/**
 * Shapes recorded from live openai/gpt-5-mini planner turns.
 * The model writes a full day list even when the card already shows it.
 * These are fixtures, not a live gateway call.
 */

export const LONG_EN_CAR = `Yes — renting a car. Here is the rebuilt trip.

Monday 16 November
08:30 Breakfast at Enzo Caffe Pizza, in town.
10:30 Bitche Rotcha Beach, a short hop west of the harbour.
13:00 Lunch at Sete Sois Sete Luas.
16:00 Cadjetinha Beach, still on the town shore.
18:10 Sunset back at Bitche Rotcha.
19:30 Dinner at Nha Terra.

Tuesday 17 November
08:30 Breakfast at Enzo Caffe Pizza again.
10:30 Bitche Rotcha Beach, same stretch as yesterday.
13:15 Lunch at Sete Sois Sete Luas.
16:00 A walk through Porto Inglês.
18:10 Sunset at Bitche Rotcha.
19:30 Dinner at Big Game Restaurant.

Wednesday 18 November
08:30 Breakfast at your stay.
10:30 Cadjetinha Beach.
13:15 Lunch at Sete Sois Sete Luas.
16:00 Free time in town.
18:10 Sunset at Bitche Rotcha.
19:30 Dinner at Nha Terra.

Times are suggestions. Tell me if you want a quieter afternoon.`;

export const LONG_PT_CORRECTION = `Na verdade, sem carro. Reconstruí os três dias.

Segunda 16 novembro
08:10 Pequeno-almoço no Enzo Caffe Pizza.
09:00 Quad (blue-rental-quad-big-game) — não pediu, mas encaixa de manhã.
10:30 Praia de Bitche Rotcha.
13:00 Almoço no Sete Sois Sete Luas.
16:00 Praia de Cadjetinha.
18:10 Pôr do sol na Bitche Rotcha.
19:30 Jantar no Nha Terra.

Terça 17 novembro
08:10 Pequeno-almoço no Enzo.
10:30 Praia de Bitche Rotcha outra vez.
13:15 Almoço no Sete Sois.
16:00 Tempo livre.
18:10 Pôr do sol.
19:30 Jantar no Big Game.

Quarta 18 novembro
08:30 Pequeno-almoço no alojamento.
10:30 Praia de Cadjetinha.
13:15 Almoço no Sete Sois.
18:10 Pôr do sol na Bitche Rotcha.
19:30 Jantar no Nha Terra.

Os horários são sugestões. Quer que eu tire o quad?`;

export const LONG_FR_NO_CAR = `3 jours, sans voiture. Voici le détail, plage par plage.

Lundi 16 novembre
08:10 Petit-déjeuner à Enzo Caffe Pizza.
09:00 Quad rental (blue-rental-quad-big-game), même si vous n'avez rien demandé.
10:30 Bitche Rotcha Beach.
13:00 Déjeuner à Sete Sois Sete Luas.
16:00 Cadjetinha Beach of Morrinho.
18:10 Coucher de soleil à Bitche Rotcha Beach.
19:30 Dîner à Sete Sois Sete Luas.

Mardi 17 novembre
08:10 Petit-déjeuner à Enzo Caffe Pizza.
10:30 Bitche Rotcha Beach, comme lundi.
13:15 Déjeuner à Sete Sois Sete Luas.
16:00 Cadjetinha Beach.
18:10 Coucher de soleil à Bitche Rotcha Beach.
19:30 Dîner à Big Game Restaurant.

Mercredi 18 novembre
08:30 Petit-déjeuner à l'hébergement.
10:30 Cadjetinha Beach.
13:15 Déjeuner à Sete Sois Sete Luas.
16:00 Temps libre à Vila do Maio.
18:10 Coucher de soleil.
19:30 Dîner à Nha Terra.

Les horaires sont des suggestions. Dites-moi si vous voulez changer un jour.`;
