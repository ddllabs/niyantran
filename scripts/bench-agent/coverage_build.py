"""Builds eval/agent/coverage.v1.jsonl from the local replica (read only). A point lists anchor phrases
from the bill's operative clauses; every operative passage of the bill (or a same-named copy) holding any
anchor is accepted. Text from the Statement of Objects and Reasons onward does not count."""
import json, re, subprocess, sys
OUT = sys.argv[1]
def sql(q):
    return subprocess.run(['docker','exec','niyantran-corpus-test-db','psql','-U','postgres','-d','niyantran_retrieval_replica','-Atc',q], capture_output=True, text=True, check=True).stdout
norm = lambda s: re.sub(r'\s+', ' ', s.replace('’', "'").replace('‘', "'").replace('“', '"').replace('”', '"')).strip().lower()
P = lambda fact, anchors, expect: (fact, anchors if isinstance(anchors, list) else [anchors], expect)
Q = [
 ('cov-01', '7f95fc7f', [], 'Under the Compulsory Registration of Religious Conversions Bill, 2005, what must a person do before converting, and what happens if the procedure is not followed?', [
   P('A memorandum must reach the Registrar 60 days before the proposed conversion, signed by the officiating priest, with a fee of five rupees (clause 5).', ['memorandum in triplicate to the Registrar of the area 60 days before the date of proposed conversion', 'the memorandum shall be accompanied by a fee of rupees five'], [3, 4]),
   P('The conversion must be completed within 45 days after the 60 days, and an intimation signed by three witnesses sent to the Registrar (clause 7).', 'completed within a period of 45 days from the date of expiry of the 60 days', [5, 6]),
   P('An unregistered conversion is not invalid for that reason alone, but it is no proof for government service and gives no right to benefits or reservation unless a certified copy is produced (clause 9).', ['shall be invalid solely by reason of the fact that it was not registered', 'unless the certified copy of the conversion is produced'], [7, 8, 9]),
   P('Failing to send the memorandum or intimation, or a false statement in them, is punishable with a fine up to two hundred rupees (clause 10).', 'punishable with fine which may extend to two hundred rupees', [9]),
   P('A Registrar who fails to file them faces rigorous imprisonment up to three months or a fine up to five hundred rupees, or both (clause 11).', 'rigorous imprisonment for a term which may extend to three months or with fine which may extend to five hundred rupees', [9, 10]),
 ]),
 ('cov-02', '28c80e39', [], 'What penalties does the Coinage Bill, 2011 set, and for what conduct?', [
   P('Contravening section 12 is punishable with imprisonment up to seven years and a fine (clause 13).', 'whoever contravenes any provisions of section 12 shall be punishable with imprisonment which may extend to seven years and with fine', [14]),
   P('Section 12 forbids using metal pieces as coin, melting or destroying coins, using coin other than as money, and holding melted, mutilated or excess coins.', 'melt or destroy any coin', [12]),
   P('Making or issuing metal pieces as coin, or holding them with intent to issue them as money: up to one year, or a fine, or both; on a repeat conviction up to three years, or a fine, or both (clause 14).', 'provided that if any person convicted under this section is again convicted, he shall be punishable with imprisonment which may extend to three years', [15]),
   P('Bringing metal pieces into India to be used as coin without permission: up to seven years and a fine (clause 15).', 'with the authority or permission of the government. (2) whoever contravenes the provisions of sub-section (1) shall be punishable with imprisonment which may extend to seven years', [15, 16]),
   P('Any coin or metal involved in an offence is forfeited to the Government (clause 17).', 'shall be forfeited to the government', [18]),
 ]),
 ('cov-03', 'a1f26a56', [], 'What does the Senior Citizens (Welfare) Bill, 2001 provide for elderly people, who qualifies, and what does it require of their families?', [
   P('Registered persons get a pension up to two thousand rupees a month, free medical aid and free housing (clause 7).', 'an amount not exceeding rupees two thousand per month as pension', [3]),
   P('District Committees register persons aged fifty-five or more who cannot work and have no means of support (clause 9).', 'register all persons who have attained the age of fifty-five years and are unable to work', [4]),
   P('The costs are met from a Senior Citizens Welfare Fund constituted by the Central Government (clauses 10 and 11).', 'constituted by the central government a fund to be known as', [5]),
   P('Every person must care for parents and grandparents without income; failure is punished with a fine of ten thousand rupees and five years imprisonment (clauses 5 and 6).', 'punished with a fine of rupees ten thousand and term of imprisonment for five years', [2, 3]),
 ]),
 ('cov-04', 'abc8411d', [], 'What penalties does the Prevention of Cruelty to Cows Bill, 2006 provide?', [
   P('Killing or attempting to kill a cow: rigorous imprisonment of two to seven years and a fine up to ten thousand rupees per cow; injuring one: a fine up to five thousand rupees (clause 9(1) and (2)).', ['rigorous imprisonment for a term which may extend to seven years but which shall not be less than two years', 'whoever causes injury to, other than killing of, cow shall be guilty of an offence punishable with fine which may extend to five thousand rupees'], [6]),
   P('Contravening section 5 or 6: imprisonment up to five years and a fine up to ten thousand rupees (clause 9(3)).', 'of the provisions of section 5 or section 6 shall be guilty of an offence punishable with imprisonment for a term which may extend to five years', [6, 7]),
   P('Sections 5 and 6 forbid exporting cows for killing, and possessing, selling or transporting beef.', ['no person shall possess or offer for sale or sell or transport beef', 'no person shall export a cow for the purpose of killing it'], [4, 5]),
   P('Offences under section 9 are cognizable and non-bailable (clause 10).', 'an offence punishable under section 9 shall be cognizable and non-bailable', [7]),
   P('"Cow" includes its progeny, bulls and bullocks, and "injury" covers cruelty such as practising phooka or injecting substances to improve lactation (clause 2).', ['"cow" includes its progeny including bulls and bullocks', 'practising phooka or doom dev'], [2, 3]),
 ]),
 ('cov-05', '05302288', ['4618230e'], 'What does the Airlines (Penalty for Delays) Bill, 2005 require an airline to pay or provide when a flight is delayed or cancelled?', [
   P('A delay over one hour or a cancellation costs at least five times the ticket price (clause 4(i)).', 'pay at least five times the price of the ticket', [1]),
   P('Boarding, lodging and other facilities must be arranged until the passenger boards the next flight, but only when the delay exceeds four hours (clause 4(ii)).', ['make arrangements for the boarding, lodging', 'shall be made only when the flight is delayed by more than four hours'], [1, 2]),
   P('A missed connection costs at least three times the connecting ticket price (clause 4(iii)).', 'pay at least three times the price of the ticket of the connecting flight', [2]),
   P('No penalty is due for bad weather certified by the Airports Authority of India or genuine technical problems (clause 5).', 'on account of bad weather as certified by airports authority of india', [2, 3]),
 ]),
 ('cov-06', '4c4f6665', ['f882ffb6'], 'What uses of the State Emblem does the State Emblem of India (Prohibition of Improper use) Bill, 2004 prohibit, and what are the penalties?', [
   P('Using the emblem so as to suggest a link to the Government, without permission, is prohibited (clause 3).', 'in any manner which tends to create an impression that it relates to the government', [1]),
   P('Contravening clause 3: up to two years, or a fine up to five thousand rupees, or both; on a repeat conviction six months to two years and a fine (clause 7(1)).', ['any person who contravenes the provisions of section 3 shall be punishable with imprisonment for a term which may extend to two years', 'the second and for every subsequent offence with imprisonment for a term which shall not be less than six months'], [5, 6]),
   P('Using the emblem in trade, business, a patent title, trade mark or design is prohibited (clause 4).', 'no person shall use the emblem for the purpose of any trade, business, calling or profession', [2]),
   P('No competent authority may register a trade mark or design bearing the emblem, or grant a patent whose title contains it (clause 5).', 'register a trade mark or design which bears the emblem', [2, 3]),
   P('Contravening clause 4 for wrongful gain: six months to two years and a fine up to five thousand rupees (clause 7(2)); prosecution for any offence under the Act needs Central Government sanction (clause 8).', 'any person who contravenes the provisions of section 4 for any wrongful gain', [6]),
 ]),
 ('cov-07', '6d9a3ff3', ['a3593d0b'], 'What are the terms of a loan from the Technology Bank of India under the Technology Bank of India Bill, 1998, and what happens if a borrower breaks them?', [
   P('The loan is interest free (clause 8(2)).', 'the loan amount so sanctioned shall be interest free', [3, 4]),
   P('It is repayable when the research is complete or five years after sanction, whichever is earlier (clause 8(4)).', 'after his research work has been completed or after a period of five years from the date of sanction of loan, whichever is earlier', [4]),
   P('The borrower undertakes not to leave the country during the research, unless the Government allows it, and may not leave before submitting the research and repaying the loan (clause 10).', ['shall give an undertaking that he shall not leave the country during the period of his research', 'shall leave the country until he has submitted his research work'], [4, 5]),
   P('Breaking clause 10 brings deportation proceedings, five years imprisonment, a five lakh rupee fine and immediate repayment (clause 13).', 'deportation proceedings shall be proceeded against him at once and he shall be punished with imprisonment for a period of five years', [6]),
 ]),
 ('cov-08', '8486fbcf', [], 'What is an offence against cultural heritage under the Cultural Heritage Protection Bill, 2003, and how is it dealt with?', [
   P('Clause 5 defines it: attempting, assisting or propagating damage to or conversion of cultural heritage, or offences against it under the Ancient Monuments Act, the Places of Worship Act, the IPC or any other law.', 'commits an offence under section 30 of the ancient monuments and archaeological sites and remains act, 1958', [7, 8]),
   P('"Cultural heritage" covers the heritage under the UNESCO Convention, ancient monuments and sites, and places of worship (clause 2(c)).', '"cultural heritage" includes', [2]),
   P('It is punished with rigorous imprisonment of at least seven years and a fine, on top of any other sentence (clause 6).', ['a term which shall not be less than seven years and fine and such imprisonment and fine shall be in addition'], [8, 9]),
   P('No limitation period bars action under clause 6, and every offence under the Act is cognizable (clauses 7 and 8).', ['no action pursuant to section 6 shall be vitiated by any consideration of the action being a delayed', 'every offence punishable under this act shall be cognizable'], [9]),
   P('The Board for Protection of Cultural Heritage enquires into offences and pursues legal action, and the police and all authorities must act in its aid (clauses 4(2)(d) and 9).', ['enquire or cause an inquiry or investigation or due legal action on offences against cultural heritage', 'shall act in aid of the board'], [5, 9]),
 ]),
 ('cov-09', '613316e2', [], 'How does a woman obtain protection under the Protection from Domestic Violence Bill, 2002, and what happens if the order is breached?', [
   P('She, someone on her behalf or the Protection Officer applies to the Magistrate, who must fix a first hearing within fifteen days (clause 9).', ['may present an application to the magistrate for seeking relief under section 14', 'fix first date of hearing which shall not exceed fifteen days'], [7, 8]),
   P('The Protection Officer, when asked, helps the parties try to settle, and files the application to the Magistrate if no settlement is reached (clause 6).', ['it shall also be the duty of the protection officer to entertain any request or application', 'if no such settlement as stated in sub-section (3) is arrived at'], [5, 6]),
   P('A protection order may direct the respondent to refrain from domestic violence and to pay monetary relief (clause 14(1)).', ['refrain from committing any act of domestic violence', 'pay such monetary relief as the magistrate deems just'], [10, 11]),
   P('The Magistrate may issue an interim protection order where immediate intervention is justified (clause 14(5)).', 'the magistrate may issue an interim protection order', [13]),
   P('A protection order lasts as fixed by the Magistrate, up to two years, and may be varied (clause 15).', 'shall be in force in the first instance for such period as the magistrate may fix but not exceeding two years', [13, 14]),
   P('Breaching a protection or interim order is an offence: up to one year or a fine up to twenty thousand rupees, or both (clause 18).', 'a breach of protection order, or of the interim protection order, by the respondent shall be an offence', [15]),
 ]),
 ('cov-10', '292a6672', [], 'What punishments and duties does the Child Labour in Hazardous Employment (Abolition, Rehabilitation and Welfare) Bill, 2000 set?', [
   P('Engaging a child in hazardous employment: at least three years and a fine of at least twenty-five thousand rupees (clause 4).', 'imprisonment which shall not be less than three years and with fine which shall not be less than twenty-five thousand rupees', [2]),
   P('Where the child is a girl, a bonded labourer, or engaged in begging, prostitution or work harming morality: at least five years and a fine of at least fifty thousand rupees, up to one lakh where the child is used as a sex worker or in smuggling or espionage (clause 4 proviso).', 'imprisonment which shall not be less than five years and with fine which shall not be less than fifty thousand rupees', [3]),
   P('A police officer who refuses to register an FIR, or abets the offence: at least two years and twenty thousand rupees (clause 7).', 'refuses to register first information report', [4]),
   P('The Government must conduct a census of child labour, rehabilitate the children found, and declare a list of hazardous employments with immediate effect (clauses 5, 6 and 8).', ['conduct census of child labour within its territorial jurisdiction', 'shall rehabilitate the child labour', 'with immediate effect declare a'], [3, 4, 5]),
   P('Employers of children in non-hazardous jobs must arrange free education, vocational training and recreation (clause 9).', 'shall arrange free education and vocational training', [5]),
 ]),
 ('cov-11', '4e3d17d5', [], 'What does the Public Liability Insurance (Amendment) Bill, 1992 change for owners who handle hazardous substances?', [
   P('A policy may not be for less than the undertaking\'s paid-up capital, nor above a prescribed amount up to fifty crore rupees (new section 4(2A)).', 'shall be for an amount less than the amount of the paid-up capital', [2]),
   P('Owners also pay, with the premium, up to the premium again for the Relief Fund (new section 4(2C)).', 'such further amount, not exceeding the sum equivalent to the amount of premium', [3]),
   P('The insurer\'s liability is capped at the policy amount, and the owner must deposit the balance of an award as the Collector directs (new section 4(2B) and section 7(3)).', ['the liability of the insurer under one insurance policy shall not exceed', 'the owner shall, within such period, deposit such amount'], [2, 3, 4, 5]),
   P('An Environmental Relief Fund is established to pay relief under the Collector\'s awards (new section 7A).', ['establish a fund to be known as the environmental relief fund', 'the relief fund shall be utilised for paying'], [5, 6]),
   P('Failing to insure at the required level or to pay the Relief Fund contribution becomes an offence under section 14 (clause 6).', 'or sub-section (2a) or sub-section (2c)', [6, 7]),
   P('"Owner" now includes a firm\'s partners, an association\'s members and a company\'s directors and officers in charge (section 2(g)).', 'in the case of a company, any of its directors, managers, secretaries', [1]),
 ]),
 ('cov-12', '10aee46c', ['a76358ab'], 'What compensation and relief does the Communal Violence (Prevention, Control and Rehabilitation of Victims) Bill, 2005 provide to victims and their families?', [
   P('At least two lakh rupees lump sum to the dependants of a person killed (clause 8).', 'compensation of not less than rupees two lakh in lumpsum', [7]),
   P('If the person killed was the sole earner, a job for one dependant within eight months (clause 9).', 'provide suitable employment to at least one eligible and dependent member', [7, 8]),
   P('The injured get compensation as recommended by the National Commission for Inter-Community Peace and Justice (clause 10).', 'pay compensation to the said person as recommended by the national commission', [8]),
   P('"Dependant" means listed relatives: a widow, minor children, unmarried daughters, a widowed mother, and others dependent on the deceased (Explanation to clauses 8 to 10).', ['"dependant" means any of the following relatives', 'a widowed daughter-in-law'], [8, 9]),
   P('The Commission invites claims for loss of life, limb, injury or property and decides compensation over and above the clause 8 sum (clause 12).', 'decide the quantum of compensation over and above the sum mentioned in section 8', [12]),
   P('Victims may appeal to civil courts against the Commission\'s compensation decisions (clause 13).', 'right to appeal to civil courts against the decision of the commission in matters of compensation', [12, 13]),
 ]),
 ('cov-13', '6367846a', [], "What does the Bachelors' Allowance Bill, 2000 give a bachelor, on what conditions, and what happens if they are broken?", [
   P('A bachelor is a citizen of India aged 21 to 50 who has never married or been betrothed (clause 2).', "the term 'bachelor' shall apply to any person who is", [0]),
   P('An allowance of five hundred rupees a month, priority for land and housing, and free medical care (clause 4).', 'an allowance of rupees five hundred per month', [1, 2]),
   P('A bachelor in Government service gets at least three additional increments and Government accommodation (clause 4(d)).', 'at least three additional increments', [2]),
   P('The bachelor must swear before a first class Magistrate to never having married (clause 3).', 'swears before a first class magistrate', [1]),
   P('The amenities need an undertaking not to marry until at least thirty-five, and marrying after thirty-five ends them (clauses 5 and 6).', ['he or she shall not marry at least till the age of thirty-five years', 'any bachelor marrying after the completion of thirty five years of age'], [3]),
   P('Violating the undertaking means losing all facilities, and ten years imprisonment and a fifty thousand rupee fine (clause 7).', ['any bachelor violating the undertaking shall be deprived of all facilities', 'shall be punished with imprisonment for a term of ten years'], [3, 4]),
 ]),
 ('cov-14', '2b0ba3dc', [], 'What consequences does the National Population Policy Bill, 1998 set for a person who has more than two children?', [
   P('Disqualification under a new section 8B of the Representation of the People Act, 1951 (clause 3).', 'a person shall be disqualified if he procreates more than two living children', [1]),
   P('Central Government and public undertaking employees lose increments and promotion; Central Government employees in Government accommodation pay double rent; more than three children ends their service (clause 4).', ['shall not be entitled to any increment or promotion in service', 'double the normal rent prescribed'], [2, 3]),
   P('Clause 4 applies to private sector employees too (clause 5).', 'the provisions of section 4 shall apply mutatis mutandis to the employees in the private sector', [3, 4]),
   P('Any person who has more than two children after the first year pays double for water and electricity, loses free education for the children, housing allotment and housing co-operative membership (clause 7).', 'double the normal charges charged for the supply of water and electricity', [4, 5]),
   P('Families already larger on commencement are exempt, and a child born within the first year does not count against the limit (section 8B proviso and (2), clause 4(4) and (5)).', ['shall not apply in case of persons having more than two living children on the date of commencement', 'shall not apply to those central government employees or employees of public undertakings who have more than the prescribed number'], [1, 2, 3]),
 ]),
 ('cov-15', '93ed3821', [], 'What conditions does the Uniform Marriage and Divorce Bill, 2004 set for a valid marriage, and what follows if they are not met?', [
   P('Conditions: valid under the law applicable, no living spouse, groom at least 21 and bride at least 18, and neither party of unsound mind, mentally unfit for marriage, unfit for procreation or subject to recurrent insanity (clause 4).', ['the bridegroom has completed the age of twenty-one years and the bride the age of eighteen years', 'has been subject to recurrent attacks of insanity'], [2, 3]),
   P('A marriage while either party has a living spouse is void and may be annulled on either party\'s petition; sections 494 and 495 IPC apply (clauses 6 and 19(1)).', ['void if at the date of such marriage either party had a husband or wife living', 'contravenes condition specified in clause (ii) of section 4'], [4, 14]),
   P('Marrying below the age condition: simple imprisonment up to fifteen days or a fine of one thousand rupees, or both (clause 19(2)).', 'in contravention of the conditions specified in clause (iii) of section 4 shall be punishable with simple imprisonment', [14, 15]),
   P('Children of a void marriage are still legitimate (clause 5).', 'any child born of such marriage who would have been legitimate if the marriage had been valid, shall be legitimate', [3]),
 ]),
]
prefixes = sorted({p for q in Q for p in [q[1], *q[2]]})
rows = sql("copy (select json_build_object('doc', d.id, 'title', d.title, 'id', c.id, 'i', c.chunk_index, 'h', c.chunk_hash, 't', c.content) from public.documents d join public.document_chunks c on c.document_id = d.id where left(d.id::text, 8) in (" + ','.join(f"'{p}'" for p in prefixes) + ")) to stdout;")
chunks = [json.loads(l.replace('\\\\', '\\')) for l in rows.splitlines() if l]
# Operative text only: a document's text stops at its Statement of Objects and Reasons.
# Its first heading after the clauses; some OCR lost the Statement's heading but kept the others.
SOR = re.compile(r'statement of objects and reasons|memorandum regarding delegated legislation|financial memorandum|^#* *annexure', re.I | re.M)
cut = {}
for c in sorted(chunks, key=lambda c: (c['doc'], c['i'])):
    if c['doc'] not in cut and SOR.search(c['t']): cut[c['doc']] = c['i']
def operative(c):
    k = cut.get(c['doc'])
    if k is None or c['i'] < k: return c['t']
    return c['t'][:SOR.search(c['t']).start()] if c['i'] == k else ''
fail, report = [], []
with open(OUT, 'w') as out:
    for qid, doc, alts, question, points in Q:
        primary = [c for c in chunks if c['doc'].startswith(doc)]
        allowed = [c for c in chunks if any(c['doc'].startswith(p) for p in [doc, *alts])]
        title, pdoc = primary[0]['title'], primary[0]['doc']
        rec = []
        for n, (fact, anchors, expect) in enumerate(points, 1):
            hits = [c for c in allowed if any(norm(a) in norm(operative(c)) for a in anchors)]
            for a in anchors:
                if not any(norm(a) in norm(operative(c)) for c in primary): fail.append(f'{qid} p{n}: anchor not found in the primary bill: {a[:60]}')
            got = sorted(c['i'] for c in hits if c['doc'] == pdoc)
            if expect is not None and got != sorted(expect): fail.append(f'{qid} p{n}: anchors in primary passages {got}, expected {expect}')
            if expect is None: report.append(f'{qid} p{n}: new point resolves to primary passages {got}')
            rec.append({'id': f'p{n}', 'fact': fact, 'anchors': anchors,
                        'passages': [{'document_id': c['doc'], 'chunk_id': c['id'], 'chunk_index': c['i'], 'chunk_hash': c['h']} for c in sorted(hits, key=lambda c: (c['doc'] != pdoc, c['doc'], c['i']))]})
        if len({frozenset(x['chunk_id'] for x in r['passages']) for r in rec}) < 2: fail.append(f'{qid}: every point sits in one passage set')
        alt_ids = sorted({x['document_id'] for r in rec for x in r['passages']} - {pdoc})
        out.write(json.dumps({'id': qid, 'question': question, 'document_id': pdoc, 'title': title, 'alternate_document_ids': alt_ids, 'points': rec}, ensure_ascii=False) + '\n')
print('\n'.join(report))
print('\n'.join(fail) or 'all anchors matched their expected passages')
print('statement of objects cut-off per bill:', {k[:8]: v for k, v in cut.items() if any(k.startswith(q[1]) for q in Q)})
