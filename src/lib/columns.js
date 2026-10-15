import { displayColumns } from './normalise.js';

const PRESETS = [
  {
    test: /^conflicts$/i,
    cols: [
      { key: 'conflict_name', label: 'THEATRE', fallback: 'title', dot: true },
      { key: 'region', label: 'REGION' },
      { key: 'current_stage', label: 'POSTURE', fallback: 'status', pill: true },
      { key: 'since', label: 'SINCE' },
      { key: 'fatalitiesEst', label: 'CASUALTIES' },
      { key: 'displaced', label: 'DISPLACEMENT' },
      { key: 'source_1', label: 'SOURCE' },
    ],
  },
  {
    test: /global intelligence|defence procurement/i,
    cols: [
      { key: 'program_name', label: 'PROGRAMME', fallback: 'title', dot: true, keep: true },
      { key: 'vendor_or_origin', label: 'VENDOR / ORIGIN', fallback: 'country', keep: true },
      { key: 'category', label: 'CATEGORY', keep: true },
      { key: 'stage', label: 'STAGE', pill: true, keep: true },
      { key: 'as_of', label: 'AS OF', fallback: 'decision_date', date: true, keep: true },
    ],
  },
  {
    test: /^alliances$/i,
    cols: [
      { key: 'title', label: 'ALLIANCE', fallback: 'name', dot: true },
      { key: 'region', label: 'REGION' },
      { key: 'category', label: 'STRUCTURE' },
      { key: 'memberCount', label: 'MEMBERS' },
      { key: 'obligation_class', label: 'OBLIGATION', pill: true },
      { key: 'latestDate', label: 'LATEST VERIFIED', date: true },
    ],
  },
  {
    test: /^sanctions$/i,
    cols: [
      { key: 'title', label: 'PROGRAMME / TARGET', fallback: 'name', dot: true },
      { key: 'issuer', label: 'ISSUER' },
      { key: 'regime_type', label: 'SCOPE', fallback: 'type' },
      { key: 'entities', label: 'LISTED ENTITIES' },
      { key: 'programme_status', label: 'STATUS', fallback: 'status', pill: true },
      { key: 'last_update', label: 'LAST UPDATE', fallback: 'updated', date: true },
    ],
  },
  {
    test: /^infra$/i,
    cols: [
      { key: 'title', label: 'PROJECT', fallback: 'name', dot: true },
      { key: 'sector', label: 'SECTOR' },
      { key: 'region', label: 'REGION' },
      { key: 'status', label: 'STATUS', pill: true },
      { key: 'cost', label: 'COST', fallback: 'value' },
      { key: 'completion', label: 'COMPLETION / PHASE', fallback: 'phase' },
    ],
  },
  {
    test: /^nuclear watch$/i,
    cols: [
      { key: 'title', label: 'FACILITY', fallback: 'name', dot: true },
      { key: 'country', label: 'COUNTRY' },
      { key: 'facility_kind', label: 'CLASS', fallback: 'kind' },
      { key: 'status', label: 'OPERATIONAL STATUS', pill: true },
      { key: 'safeguards', label: 'SAFEGUARDS / SECURITY', fallback: 'security_status' },
      { key: 'latest', label: 'LATEST VERIFIED', fallback: 'note', date: true },
    ],
  },
  {
    test: /^satellite infrastructure$/i,
    cols: [
      { key: 'title', label: 'ASSET / CONSTELLATION', fallback: 'name', dot: true },
      { key: 'provider', label: 'OPERATOR', fallback: 'operator' },
      { key: 'country', label: 'COUNTRY' },
      { key: 'pad', label: 'ORBIT / PAD', fallback: 'orbit' },
      { key: 'function', label: 'FUNCTION' },
      { key: 'status', label: 'STATUS', pill: true },
      { key: 'net', label: 'LAUNCH / COMMISSIONED', fallback: 'expected', date: true },
    ],
  },
  {
    test: /^maritime choke-?points$/i,
    cols: [
      { key: 'title', label: 'CHOKEPOINT', fallback: 'name', dot: true },
      { key: 'region', label: 'REGION' },
      { key: 'oil', label: 'SHARE OF FLOW', fallback: 'share' },
      { key: 'status', label: 'CURRENT RISK', pill: true },
      { key: 'trend', label: 'TREND', pill: true },
      { key: 'latest_incident', label: 'LATEST INCIDENT', fallback: 'latest' },
    ],
  },
  {
    test: /^global aid$/i,
    cols: [
      { key: 'title', label: 'PROGRAMME', fallback: 'name', dot: true },
      { key: 'agency', label: 'INSTITUTION / REGION', fallback: 'region' },
      { key: 'requirement', label: 'REQUIREMENT' },
      { key: 'funded', label: 'FUNDED', fallback: 'funding' },
      { key: 'gap', label: 'GAP' },
      { key: 'people_targeted', label: 'PEOPLE TARGETED', fallback: 'people' },
      { key: 'dataThrough', label: 'DATA THROUGH', date: true },
    ],
  },
  {
    test: /^transit$/i,
    cols: [
      { key: 'title', label: 'IDENTIFIER', fallback: 'name', dot: true },
      { key: 'type', label: 'TYPE', pill: true },
      { key: 'flag', label: 'FLAG', fallback: 'country' },
      { key: 'route', label: 'ORIGIN → DESTINATION', fallback: 'destination' },
      { key: 'last_ping', label: 'LAST PING', fallback: 'updated', date: true },
      { key: 'speed', label: 'SPEED' },
      { key: 'alert', label: 'ALERT', pill: true },
    ],
  },
  {
    test: /open fronts/i,
    cols: [
      { key: 'conflict_name', label: 'CONFLICT', fallback: 'title', dot: true, keep: true },
      { key: 'region', label: 'REGION', keep: true },
      { key: 'conflict_type', label: 'TYPE', keep: true },
      { key: 'current_stage', label: 'STATUS', pill: true, keep: true },
      { key: 'intensity', label: 'INTENSITY', pill: true, keep: true },
      { key: 'trend', label: 'TREND', pill: true, keep: true },
      { key: 'last_verified', label: 'LAST VERIFIED', fallback: 'updated', date: true },
    ],
  },
  {
    test: /bill passage/i,
    cols: [
      { key: 'bill_name', label: 'Bill', fallback: 'title', dot: true },
      { key: 'house', label: 'House' },
      { key: 'sector', label: 'Sector' },
      { key: 'current_stage', label: 'Stage', pill: true },
      { key: 'date_introduced', label: 'Introduced', fallback: 'date', date: true },
      { key: 'probability_score', label: 'Passage score', num: true, default: false },
    ],
  },
  {
    test: /policy pipeline/i,
    cols: [
      { key: 'policy_name', label: 'POLICY', fallback: 'title', dot: true },
      { key: 'ministry', label: 'MINISTRY' },
      { key: 'stage', label: 'STAGE', pill: true },
      { key: 'date_reported', label: 'LAST OFFICIAL ACTION', fallback: 'date', date: true },
      { key: 'next_milestone', label: 'NEXT MILESTONE' },
      { key: 'consultation_deadline', label: 'CONSULTATION DEADLINE', date: true },
      { key: 'updated', label: 'UPDATED', date: true },
    ],
  },
  {
    test: /parliamentary question/i,
    cols: [
      { key: 'subject', label: 'QUESTION', fallback: 'title', dot: true, keep: true },
      { key: 'mp_name', label: 'MEMBER', keep: true },
      { key: 'ministry', label: 'MINISTRY', keep: true },
      { key: 'question_type', label: 'TYPE', pill: true },
      { key: 'date', label: 'TABLED', date: true },
      { key: 'house', label: 'HOUSE' },
      { key: 'session', label: 'SESSION', default: false },
      { key: 'has_answer', label: 'HAS ANSWER', default: false },
    ],
  },
  {
    test: /regulatory body watch/i,
    cols: [
      { key: 'title', label: 'INSTRUMENT', fallback: 'name', dot: true },
      { key: 'regulator', label: 'REGULATOR' },
      { key: 'action_type', label: 'TYPE', pill: true },
      { key: 'date', label: 'DATE', date: true },
      { key: 'effective_date', label: 'EFFECTIVE', date: true },
      { key: 'instrument_status', label: 'STATUS', fallback: 'status', pill: true },
    ],
  },
  {
    test: /candidate affidavit/i,
    cols: [
      { key: 'name', label: 'CANDIDATE', fallback: 'title', dot: true },
      { key: 'constituency', label: 'CONSTITUENCY' },
      { key: 'party', label: 'PARTY' },
      { key: 'criminal_cases', label: 'CASES', num: true },
      { key: 'education', label: 'EDUCATION' },
      { key: 'total_assets', label: 'ASSETS (₹ CR)', inr: true },
      { key: 'liabilities', label: 'LIABILITIES (₹ CR)', inr: true },
    ],
  },
  {
    test: /central tender/i,
    cols: [
      { key: 'tender_id', label: 'TENDER ID', fallback: 'id' },
      { key: 'authority', label: 'AUTHORITY', fallback: 'organisation' },
      { key: 'tender_title', label: 'TENDER', fallback: 'title', dot: true },
      { key: 'category', label: 'CATEGORY' },
      { key: 'location', label: 'LOCATION' },
      { key: 'value_inr', label: 'VALUE (₹)', inr: true },
      { key: 'deadline', label: 'DEADLINE', date: true },
      { key: 'status', label: 'STATUS', pill: true, default: false },
      { key: '_closes', label: 'CLOSES', default: false },
    ],
  },
  {
    test: /agmut|bureaucratic transfers/i,
    cols: [
      { key: 'officer_name', label: 'OFFICER', fallback: 'title', dot: true },
      { key: 'cadre', label: 'CADRE' },
      { key: 'jurisdiction', label: 'STATE / UT' },
      { key: 'new_posting', label: 'NEW POSTING' },
      { key: 'order_date', label: 'ORDER', fallback: 'date' },
    ],
  },
  {
    test: /cabinet decisions/i,
    cols: [
      { key: 'topic', label: 'Decision', fallback: 'title', dot: true },
      { key: 'ministry', label: 'Ministry', fallback: 'department' },
      { key: 'priority', label: 'Operational attention', pill: true },
      { key: 'date', label: 'Date', date: true },
      { key: 'financial_outlay', label: 'Outlay', fallback: 'outlay' },
      { key: 'implementation_status', label: 'Implementation', fallback: 'status', pill: true },
      { key: 'source_label', label: 'Source', fallback: 'source_url' },
    ],
  },
  {
    test: /centre-sanctioned projects/i,
    cols: [
      { key: 'project_name', label: 'PROJECT', fallback: 'title', dot: true },
      { key: 'status', label: 'STATUS', pill: true },
      { key: 'totalamt', label: 'AMOUNT', fallback: 'totalamt' },
      { key: 'boardapprovaldate', label: 'APPROVED', fallback: 'date' },
    ],
  },
  {
    test: /industry updates/i,
    cols: [
      { key: 'date', label: 'YEAR', fallback: 'year', num: true },
      { key: 'value', label: 'INDUSTRY % OF GDP', num: true },
      { key: 'country', label: 'ECONOMY', fallback: 'title' },
    ],
  },
  {
    test: /mp profiles/i,
    cols: [
      { key: 'mp_name', label: 'MEMBER', fallback: 'title', dot: true },
      { key: 'party', label: 'PARTY' },
      { key: 'constituency', label: 'SEAT' },
      { key: 'state', label: 'STATE' },
      { key: 'questions_asked', label: 'QUESTIONS', num: true },
    ],
  },
  {
    test: /^economic overview of all countries$/i,
    cols: [
      { key: 'country', label: 'ECONOMY', fallback: 'title', dot: true, keep: true },
      { key: 'year', label: 'YEAR', num: true },
      { key: 'gdp_usd_bn', label: 'GDP (US$ BN)', num: true, keep: true },
    ],
  },
  {
    test: /^key financial indicators/i,
    cols: [
      { key: 'country', label: 'ECONOMY', fallback: 'title', dot: true, keep: true },
      { key: 'year', label: 'YEAR', num: true },
      { key: 'gdp_growth', label: 'GDP GROWTH %', num: true },
      { key: 'inflation', label: 'CPI %', num: true },
      { key: 'emp_to_pop', label: 'EMP-TO-POP %', num: true },
    ],
  },
  {
    test: /growth indicator/i,
    cols: [
      { key: 'economy', label: 'ECONOMY', fallback: 'country', dot: true, keep: true },
      { key: 'gdp_growth', label: 'REAL GDP GROWTH (%)', num: true },
      { key: 'inflation', label: 'INFLATION (%)', num: true },
      { key: 'unemployment', label: 'UNEMPLOYMENT (%)', num: true },
      { key: 'fiscal_balance', label: 'FISCAL BALANCE (%)', num: true },
      { key: 'period', label: 'PERIOD', fallback: 'year' },
      { key: 'period_type', label: 'TYPE' },
      { key: 'revision', label: 'REVISION', default: false },
      { key: 'source', label: 'SOURCE', default: false },
    ],
  },
  {
    test: /^world constitutions$/i,
    cols: [
      { key: 'country', label: 'COUNTRY', fallback: 'title', dot: true },
      { key: 'enacted', label: 'ENACTED', num: true },
    ],
  },
  {
    test: /^heads of state$/i,
    cols: [
      { key: 'country', label: 'COUNTRY', fallback: 'title', dot: true, keep: true },
      { key: 'name', label: 'NAME', fallback: 'head_of_state' },
      { key: 'office', label: 'OFFICE', fallback: 'role' },
      { key: 'status', label: 'STATUS' },
      { key: 'term_start', label: 'TERM START', fallback: 'since' },
      { key: 'next_transition', label: 'NEXT TRANSITION' },
      { key: 'last_verified', label: 'LAST VERIFIED', default: false },
      { key: 'authority', label: 'AUTHORITY', default: false },
    ],
  },
  {
    test: /^global commodities$/i,
    cols: [
      { key: 'commodity', label: 'BENCHMARK', fallback: 'title', dot: true },
      { key: 'group', label: 'GROUP' },
      { key: 'level', label: 'LEVEL', num: true },
      { key: 'change', label: 'CHANGE', num: true },
    ],
  },
  {
    test: /^geopolitics news wire$/i,
    cols: [
      { key: 'title', label: 'HEADLINE', fallback: 'name', dot: true, keep: true },
      { key: 'region', label: 'REGION' },
      { key: 'topic', label: 'TOPIC' },
      { key: 'outlet', label: 'SOURCE', fallback: 'source' },
      { key: 'published', label: 'PUBLISHED', fallback: 'date' },
      { key: 'verification', label: 'VERIFICATION' },
      { key: 'related_count', label: 'RELATED', num: true },
    ],
  },
  {
    test: /^global trade$/i,
    cols: [
      { key: 'country', label: 'ECONOMY', fallback: 'title', dot: true },
      { key: 'year', label: 'YEAR', num: true },
      { key: 'exports_bn', label: 'MERCH. EXPORTS (US$ BN)', num: true },
      { key: 'trade_gdp', label: 'TRADE (% OF GDP)', num: true },
    ],
  },
  {
    test: /^critical minerals$/i,
    cols: [
      { key: 'mineral', label: 'MINERAL', fallback: 'title', dot: true, keep: true },
      { key: 'producers', label: 'LEADING PRODUCERS', keep: true },
      { key: 'top3_share', label: 'TOP-3 PROD. SHARE' },
      { key: 'top_processor', label: 'TOP PROCESSOR' },
      { key: 'import_dependency', label: 'IMPORT DEPENDENCY' },
      { key: 'risk', label: 'RISK' },
      { key: 'data_year', label: 'DATA YEAR' },
      { key: 'note', label: 'STRATEGIC NOTE', default: false },
    ],
  },
  {
    test: /^constituency register$/i,
    cols: [
      { key: 'name', label: 'CONSTITUENCY', fallback: 'title', dot: true },
      { key: 'ac', label: 'AC' },
      { key: 'district', label: 'DISTRICT' },
      { key: 'electors', label: 'ELECTORS', num: true },
      { key: 'booths', label: 'BOOTHS', num: true },
      { key: 'bloc', label: 'LEADING BLOC (EST.)' },
      { key: 'leadPct', label: 'LEAD %', num: true },
      { key: 'status', label: 'STATUS 2022', pill: true },
    ],
  },
  {
    test: /^roll demography$/i,
    cols: [
      { key: 'name', label: 'CONSTITUENCY', fallback: 'title', dot: true },
      { key: 'ac', label: 'AC' },
      { key: 'electors', label: 'ELECTORS', num: true },
      { key: 'male', label: 'MALE', num: true },
      { key: 'female', label: 'FEMALE', num: true },
      { key: 'sexRatio', label: 'SEX RATIO', num: true },
      { key: 'medianAge', label: 'MEDIAN AGE', num: true },
      { key: 'young', label: '18-25 %', num: true },
      { key: 'senior', label: '60+ %', num: true },
    ],
  },
  {
    test: /^community bloc matrix$/i,
    cols: [
      { key: 'name', label: 'CONSTITUENCY', fallback: 'title', dot: true },
      { key: 'ac', label: 'AC' },
      { key: 'electors', label: 'ELECTORS', num: true },
      { key: 'catholic', label: 'CATHOLIC %', num: true },
      { key: 'muslim', label: 'MUSLIM %', num: true },
      { key: 'st', label: 'HINDU ST %', num: true },
      { key: 'obc', label: 'HINDU OBC %', num: true },
      { key: 'general', label: 'HINDU GEN %', num: true },
      { key: 'sc', label: 'HINDU SC %', num: true },
      { key: 'other', label: 'OTHER / RESIDUAL %', num: true, default: false },
      { key: 'bloc', label: 'LEADING BLOC (EST.)', default: false },
    ],
  },
  {
    test: /^election results 2017/i,
    cols: [
      { key: 'name', label: 'CONSTITUENCY', fallback: 'title', dot: true },
      { key: 'ac', label: 'AC' },
      { key: 'w2017', label: '2017' },
      { key: 'w2019', label: '2019' },
      { key: 'w2022', label: '2022' },
      { key: 'pct2022', label: '2022 %', num: true },
      { key: 'margin2022', label: '2022 MARGIN', num: true },
      { key: 'w2024', label: '2024' },
      { key: 'distinct', label: 'DISTINCT WINNERS', num: true },
    ],
  },
  {
    test: /^split-ticket/i,
    cols: [
      { key: 'name', label: 'CONSTITUENCY', fallback: 'title', dot: true },
      { key: 'ac', label: 'AC' },
      { key: 'ac22', label: 'AC 2022 %', num: true },
      { key: 'ls24', label: 'LS 2024 %', num: true },
      { key: 'gap', label: 'SPLIT GAP', num: true },
      { key: 'inPlay', label: 'IN-PLAY ELECTORS', num: true },
      { key: 'inPlayPct', label: 'IN-PLAY %', num: true },
      { key: 'status', label: 'STATUS 2022', pill: true },
    ],
  },
  {
    test: /^sir roll churn$/i,
    cols: [
      { key: 'name', label: 'CONSTITUENCY', fallback: 'title', dot: true },
      { key: 'ac', label: 'AC' },
      { key: 'draft', label: 'DRAFT', num: true },
      { key: 'final', label: 'FINAL', num: true },
      { key: 'added', label: 'ADDED', num: true },
      { key: 'removed', label: 'REMOVED', num: true },
      { key: 'net', label: 'NET', num: true },
      { key: 'netPct', label: 'NET %', num: true },
    ],
  },
  {
    test: /^registration gap$/i,
    cols: [
      { key: 'name', label: 'CONSTITUENCY', fallback: 'title', dot: true },
      { key: 'ac', label: 'AC' },
      { key: 'electors', label: 'ELECTORS', num: true },
      { key: 'aged', label: 'AGED 18-19', num: true },
      { key: 'missing', label: 'MISSING 18-19', num: true },
      { key: 'pct', label: '% OF SEAT', num: true },
    ],
  },
  {
    test: /^booth register$/i,
    cols: [
      { key: 'boothNo', label: 'BOOTH', fallback: 'title', dot: true, keep: true },
      { key: 'station', label: 'STATION', keep: true },
      { key: 'electors', label: 'ELECTORS', num: true },
      { key: 'households', label: 'HOUSEHOLDS', num: true },
      { key: 'ops', label: 'OPS CLASS', pill: true },
      { key: 'status', label: 'STATUS', pill: true },
      { key: 'bloc', label: 'LEADING BLOC (EST.)' },
    ],
  },
  {
    test: /^booth demography$/i,
    cols: [
      { key: 'boothNo', label: 'BOOTH', fallback: 'title', dot: true, keep: true },
      { key: 'station', label: 'STATION', keep: true },
      { key: 'sexRatio', label: 'SEX RATIO', num: true },
      { key: 'meanAge', label: 'MEAN AGE', num: true },
      { key: 'senior', label: '60+ %', num: true },
      { key: 'young', label: '18-25 %', num: true },
      { key: 'male', label: 'MALE', num: true },
      { key: 'female', label: 'FEMALE', num: true },
      { key: 'electors', label: 'ELECTORS', num: true },
    ],
  },
  {
    test: /^booth bloc composition$/i,
    cols: [
      { key: 'boothNo', label: 'BOOTH', fallback: 'title', dot: true, keep: true },
      { key: 'station', label: 'STATION', keep: true },
      { key: 'catholic', label: 'CATHOLIC %', num: true },
      { key: 'muslim', label: 'MUSLIM %', num: true },
      { key: 'st', label: 'HINDU ST %', num: true },
      { key: 'obc', label: 'HINDU OBC %', num: true },
      { key: 'general', label: 'HINDU GEN %', num: true },
      { key: 'sc', label: 'HINDU SC %', num: true },
      { key: 'other', label: 'OTHER / RESIDUAL %', num: true, default: false },
      { key: 'bloc', label: 'LEADING BLOC (EST.)', pill: true },
      { key: 'electors', label: 'ELECTORS', num: true, default: false },
    ],
  },
  {
    test: /^booth-level roll churn$/i,
    cols: [
      { key: 'boothNo', label: 'BOOTH', fallback: 'title', dot: true, keep: true },
      { key: 'station', label: 'STATION', keep: true },
      { key: 'added', label: 'SIR ADDED', num: true },
      { key: 'removed', label: 'SIR REMOVED', num: true },
      { key: 'net', label: 'NET', num: true },
      { key: 'netPct', label: 'NET %', num: true },
      { key: 'electors', label: 'ELECTORS', num: true },
    ],
  },
  {
    test: /^booth political history$/i,
    cols: [
      { key: 'boothNo', label: 'BOOTH', fallback: 'title', dot: true, keep: true },
      { key: 'station', label: 'STATION', keep: true },
      { key: 'l17', label: '2017' },
      { key: 'l19', label: '2019' },
      { key: 'l22', label: '2022' },
      { key: 'l24', label: '2024' },
      { key: 'flips', label: 'FLIPS', num: true },
      { key: 'margin24', label: '2024 MARGIN', num: true },
      { key: 'turnout', label: 'TURNOUT 2024 %', num: true },
    ],
  },
  {
    test: /^booth-level results/i,
    cols: [
      { key: 'boothNo', label: 'BOOTH', fallback: 'title', dot: true, keep: true },
      { key: 'station', label: 'STATION', keep: true },
      { key: 'electors', label: 'ELECTORS', num: true },
      { key: 'status', label: '2022 BAND', pill: true },
      { key: 'l22', label: '2022' },
      { key: 'l24', label: '2024' },
      { key: 'margin24', label: '2024 MARGIN', num: true },
      { key: 'bloc', label: 'LEADING BLOC (EST.)' },
    ],
  },
  {
    test: /^swing booths$/i,
    cols: [
      { key: 'boothNo', label: 'BOOTH', fallback: 'title', dot: true, keep: true },
      { key: 'station', label: 'STATION', keep: true },
      { key: 'electors', label: 'ELECTORS', num: true },
      { key: 'bloc', label: 'LEADING BLOC (EST.)' },
      { key: 'leadPct', label: 'LEAD %', num: true },
      { key: 'enc', label: 'ENC', num: true },
    ],
  },
  {
    test: /^anchor booths$/i,
    cols: [
      { key: 'boothNo', label: 'BOOTH', fallback: 'title', dot: true, keep: true },
      { key: 'station', label: 'STATION', keep: true },
      { key: 'electors', label: 'ELECTORS', num: true },
      { key: 'bloc', label: 'LEADING BLOC (EST.)' },
      { key: 'leadPct', label: 'LEAD %', num: true },
    ],
  },
  {
    test: /^local governance brief$/i,
    cols: [
      { key: 'taluka', label: 'TALUKA', fallback: 'name', dot: true },
      { key: 'district', label: 'DISTRICT' },
      { key: 'seats', label: 'SEATS', num: true },
      { key: 'electors', label: 'ELECTORS', num: true },
      { key: 'booths', label: 'BOOTHS', num: true },
      { key: 'status_mix', label: 'STATUS MIX', pill: true },
      { key: 'leading_bloc_mix', label: 'LEADING BLOC (EST.)' },
    ],
  },
  {
    test: /^supreme court order/i,
    cols: [
      { key: 'case_title', label: 'CASE', fallback: 'title', dot: true, keep: true },
      { key: 'diary_no', label: 'DIARY' },
      { key: 'date', label: 'ORDER DATE', fallback: 'order_date' },
      // D14: topic was 95% "Other / Unclassified" — not a useful facet; dropped.
      { key: 'court', label: 'COURT' },
    ],
  },
  {
    test: /^order archive by topic/i,
    cols: [
      { key: 'case_title', label: 'CASE', fallback: 'title', dot: true, keep: true },
      { key: 'diary_no', label: 'DIARY' },
      { key: 'date', label: 'ORDER DATE', fallback: 'order_date' },
      { key: 'court', label: 'COURT' },
    ],
  },
  {
    // F129: the WTO dispute register. News rows (the fallback when the register is missing) carry no
    // DS number, so they take the generic columns instead.
    test: /^wto dispute settlement$/i,
    onlyIf: (rows) => rows.some((r) => r && r.ds_number),
    cols: [
      { key: 'ds_number', label: 'DS', dot: true },
      { key: 'short_title', label: 'DISPUTE', fallback: 'title' },
      { key: 'complainant', label: 'COMPLAINANT' },
      { key: 'respondent', label: 'RESPONDENT' },
      { key: 'status', label: 'STAGE', pill: true },
      { key: 'date', label: 'REQUESTED' },
      { key: 'title', label: 'MEASURE', default: false },
    ],
  },
  {
    test: /^nclt/i,
    cols: [
      { key: 'entity', label: 'ENTITY', fallback: 'title', dot: true, keep: true },
      { key: 'subject', label: 'MATTER' },
      { key: 'remarks', label: 'ORDER', pill: true },
      { key: 'court', label: 'SOURCE' },
      { key: 'date', label: 'DATE' },
      { key: 'insolvency_professional', label: 'IP' },
    ],
  },
  {
    test: /supreme courts & precedent — united states/i,
    cols: [
      { key: 'title', label: 'CASE', fallback: 'caseName', dot: true, keep: true },
      { key: 'date', label: 'FILED' },
      { key: 'cite', label: 'CITE' },
      { key: 'status', label: 'STATUS', pill: true },
      { key: 'docket', label: 'DOCKET' },
      { key: 'court', label: 'COURT' },
    ],
  },
  {
    test: /^nse\/bse delayed market feed$/i,
    cols: [
      { key: 'name', label: 'INDEX / STOCK', fallback: 'title', dot: true, keep: true },
      { key: 'exchange', label: 'VENUE', pill: true },
      { key: 'last', label: 'LAST', num: true },
      { key: 'change', label: 'CHANGE', num: true },
      { key: 'pct_change', label: 'CHG %', num: true },
      { key: 'as_of', label: 'AS OF', fallback: 'asOf', date: true, keep: true },
      { key: 'open', label: 'OPEN', num: true },
      { key: 'high', label: 'HIGH', num: true },
      { key: 'low', label: 'LOW', num: true },
    ],
  },
  {
    test: /^live global stock exchanges$/i,
    cols: [
      { key: 'name', label: 'INDEX', fallback: 'title', dot: true, keep: true },
      { key: 'venue', label: 'VENUE', fallback: 'exchange', pill: true },
      { key: 'last', label: 'LAST', num: true },
      { key: 'change', label: 'CHANGE', num: true },
      { key: 'pct_change', label: 'CHG %', num: true },
      { key: 'date', label: 'AS OF' },
    ],
  },
  {
    test: /^trade agreements/i,
    cols: [
      { key: 'subject', label: 'NOTIFICATION', fallback: 'title', dot: true, keep: true },
      { key: 'notification_no', label: 'NO.' },
      { key: 'date', label: 'DATE' },
      { key: 'year', label: 'YEAR' },
    ],
  },
  {
    test: /^sector policy/i,
    cols: [
      { key: 'year', label: 'YEAR', num: true, keep: true },
      { key: 'country', label: 'COUNTRY' },
      { key: 'indicator', label: 'SERIES', fallback: 'title', keep: true },
      { key: 'value', label: 'VALUE', num: true },
    ],
  },
  {
    test: /^top financial & business players$/i,
    cols: [
      { key: 'person', label: 'CHIEF EXECUTIVE', fallback: 'title', dot: true, keep: true },
      { key: 'company', label: 'ENTERPRISE', keep: true },
    ],
  },
  {
    test: /^economic simulator$/i,
    cols: [
      { key: 'year', label: 'YEAR', num: true, keep: true },
      { key: 'country', label: 'COUNTRY', keep: true },
      { key: 'indicator', label: 'SERIES', keep: true },
      { key: 'gdp_growth_pct', label: 'GDP GROWTH %', fallback: 'value', num: true, keep: true },
      { key: 'unit', label: 'UNIT' },
    ],
  },
  {
    test: /^prediction market political odds$/i,
    cols: [
      { key: 'question', label: 'MARKET', fallback: 'title', dot: true, keep: true },
      { key: 'probability', label: 'YES %', num: true },
      { key: 'volume_24h', label: 'VOL 24H', num: true },
      { key: 'total_volume', label: 'VOLUME', num: true },
      { key: 'date', label: 'CLOSES' },
    ],
  },
  {
    // F196: Manifold markets on Indian elections (src/lib/econPack.js mapManifoldIndiaElections).
    test: /^election forecast aggregator$/i,
    cols: [
      { key: 'question', label: 'MARKET', fallback: 'title', dot: true, keep: true },
      { key: 'probability', label: 'YES %', num: true },
      { key: 'top_outcome', label: 'LEADING ANSWER' },
      { key: 'top_outcome_pct', label: 'LEADING %', num: true },
      { key: 'total_volume', label: 'VOLUME (MANA)', num: true },
      { key: 'close_time', label: 'CLOSES' },
      { key: 'resolved', label: 'RESOLVED', pill: true },
      { key: 'market_type', label: 'TYPE', pill: true },
    ],
  },
  {
    // F196: the RBI Handbook of Statistics on Indian States, one table at a time (src/lib/rbiHandbook.js).
    test: /^(state economic data \(gsdp, sectors\)|state fiscal deep-dive|niti aayog state indices|district (health & nutrition|education|economic & livelihood|agriculture & rural) indicators|district infrastructure & connectivity)$/i,
    cols: [
      { key: 'state', label: 'STATE', dot: true, keep: true },
      { key: 'indicator', label: 'INDICATOR', keep: true },
      { key: 'year', label: 'YEAR', keep: true },
      { key: 'value', label: 'VALUE', num: true, keep: true },
      { key: 'unit', label: 'UNIT' },
      { key: 'price_basis', label: 'PRICES' },
      { key: 'estimate', label: 'ESTIMATE', pill: true },
      { key: 'table_title', label: 'TABLE' },
    ],
  },
  {
    // F196: one handbook table, every state ranked (src/lib/stateComparison.js).
    test: /^cross-state comparison engine$/i,
    cols: [
      { key: 'rank', label: 'RANK', num: true, keep: true },
      { key: 'state', label: 'STATE', dot: true, keep: true },
      { key: 'indicator', label: 'INDICATOR', keep: true },
      { key: 'year', label: 'YEAR', keep: true },
      { key: 'value', label: 'VALUE', num: true, keep: true },
      { key: 'unit', label: 'UNIT' },
      { key: 'previous_year', label: 'YEAR BEFORE' },
      { key: 'previous_value', label: 'VALUE BEFORE', num: true },
      { key: 'change_pct', label: 'CHANGE %', num: true },
    ],
  },
  {
    // F196: RBI State Government Securities auctions, one row per security (src/lib/rbiSdl.js).
    test: /^sdl auction & borrowing tracker$/i,
    cols: [
      { key: 'date', label: 'RELEASE', date: true, keep: true },
      { key: 'stage', label: 'STAGE', pill: true, keep: true },
      { key: 'state', label: 'STATE', dot: true, keep: true },
      { key: 'notified_crore', label: 'NOTIFIED (₹ CR)', num: true, keep: true },
      { key: 'accepted_crore', label: 'ACCEPTED (₹ CR)', num: true },
      { key: 'cutoff_yield', label: 'CUT-OFF YIELD %', num: true },
      { key: 'cutoff_price', label: 'CUT-OFF PRICE ₹', num: true },
      { key: 'tenor', label: 'TENOR / RE-ISSUE' },
      { key: 'auction_type', label: 'AUCTION', pill: true },
      { key: 'auction_date', label: 'AUCTION DATE', date: true },
    ],
  },
  {
    // F196: party seat strength per assembly (src/lib/partyStrength.js partyStrengthRows).
    test: /^party organisation map$/i,
    cols: [
      { key: 'state', label: 'STATE', fallback: 'title', dot: true, keep: true },
      { key: 'seats', label: 'SEATS', num: true },
      { key: 'largest_party', label: 'LARGEST PARTY' },
      { key: 'largest_seats', label: 'ITS SEATS', num: true },
      { key: 'largest_share', label: 'SHARE %', num: true },
      { key: 'majority', label: 'MAJORITY' },
      { key: 'breakdown', label: 'SEATS BY PARTY' },
    ],
  },
  {
    test: /^carbon border/i,
    cols: [
      { key: 'milestone', label: 'Milestone', fallback: 'title', dot: true, keep: true },
      { key: 'jurisdiction', label: 'Jurisdiction', pill: true },
      { key: 'date', label: 'Date' },
      { key: 'detail', label: 'Scope / note', keep: true },
    ],
  },
  {
    test: /^global carbon pricing tracker$/i,
    cols: [
      { key: 'jurisdiction', label: 'Jurisdiction', fallback: 'title', dot: true, keep: true },
      { key: 'ets_status', label: 'ETS', pill: true },
      { key: 'carbon_tax', label: 'Tax' },
      { key: 'coverage_pct', label: 'Coverage %', num: true },
      { key: 'weighted_price_usd', label: 'USD / tCO2e', num: true },
      { key: 'year', label: 'Year', num: true },
    ],
  },
  {
    test: /^carbon price monitor$/i,
    cols: [
      { key: 'jurisdiction', label: 'Jurisdiction', fallback: 'title', dot: true, keep: true },
      { key: 'year', label: 'Year', num: true },
      { key: 'weighted_price_usd', label: 'Weighted USD/t', num: true },
      { key: 'ets_price_usd', label: 'ETS USD/t', num: true },
    ],
  },
  {
    test: /^ets & tax adoption timeline$/i,
    cols: [
      { key: 'jurisdiction', label: 'Jurisdiction', fallback: 'title', dot: true, keep: true },
      { key: 'first_instrument_year', label: 'First year', num: true },
      { key: 'carbon_tax_since', label: 'Tax since', num: true },
      { key: 'ets_since', label: 'ETS since', num: true },
      { key: 'instruments', label: 'Instruments', pill: true },
    ],
  },
  {
    test: /^india ccts/i,
    cols: [
      { key: 'milestone', label: 'Milestone', fallback: 'title', dot: true, keep: true },
      { key: 'date', label: 'Date' },
      { key: 'detail', label: 'Legal basis / note', keep: true },
    ],
  },
  {
    test: /^carbon registry wire$/i,
    cols: [
      { key: 'title', label: 'Publication', fallback: 'title', dot: true, keep: true },
      { key: 'registry', label: 'Registry', pill: true },
      { key: 'date', label: 'Date' },
    ],
  },
  {
    test: /^climate newswire$/i,
    cols: [
      { key: 'title', label: 'Headline', fallback: 'title', dot: true, keep: true },
      { key: 'outlet', label: 'Source', fallback: 'source', pill: true },
      { key: 'published', label: 'Published', fallback: 'date' },
    ],
  },
  {
    test: /^cricket wire$|^football wire$|^indian sports wire$/i,
    cols: [
      { key: 'title', label: 'HEADLINE', fallback: 'title', dot: true, keep: true },
      { key: 'outlet', label: 'SOURCE', fallback: 'source', pill: true },
      { key: 'published', label: 'PUBLISHED', fallback: 'date' },
      { key: 'verification', label: 'VERIFICATION' },
      { key: 'related_count', label: 'RELATED', num: true },
    ],
  },
  {
    test: /^fixtures & results|^isl tracker$/i,
    cols: [
      { key: 'title', label: 'FIXTURE', fallback: 'title', dot: true, keep: true },
      { key: 'league', label: 'LEAGUE', pill: true },
      { key: 'date', label: 'DATE' },
      { key: 'home', label: 'HOME' },
      { key: 'away', label: 'AWAY' },
      { key: 'home_score', label: 'HS', num: true },
      { key: 'away_score', label: 'AS', num: true },
      { key: 'status', label: 'STATUS', pill: true },
    ],
  },
  {
    test: /^sports business/i,
    cols: [
      { key: 'league', label: 'LEAGUE', fallback: 'title', dot: true, keep: true },
      { key: 'owner', label: 'OWNER' },
    ],
  },
  {
    test: /^athlete index$/i,
    cols: [
      { key: 'person', label: 'ATHLETE', fallback: 'title', dot: true, keep: true },
      { key: 'sport', label: 'SPORT', pill: true },
    ],
  },
  {
    test: /^tv & streaming tonight$/i,
    cols: [
      { key: 'show', label: 'SHOW', fallback: 'title', dot: true, keep: true },
      { key: 'network', label: 'NETWORK', pill: true },
      { key: 'country', label: 'COUNTRY', pill: true },
      { key: 'time', label: 'AIRTIME' },
      { key: 'episode', label: 'EPISODE', keep: true },
    ],
  },
  {
    test: /^box office tracker$/i,
    cols: [
      { key: 'film', label: 'FILM', fallback: 'title', dot: true, keep: true },
      { key: 'release_date', label: 'RELEASE' },
      { key: 'box_office', label: 'BOX OFFICE (WD)', num: true },
    ],
  },
  {
    test: /^entertainment news wire$|^bollywood & film wire$/i,
    cols: [
      { key: 'title', label: 'HEADLINE', fallback: 'title', dot: true, keep: true },
      { key: 'outlet', label: 'SOURCE', fallback: 'source', pill: true },
      { key: 'published', label: 'PUBLISHED', fallback: 'date' },
      { key: 'verification', label: 'VERIFICATION' },
      { key: 'related_count', label: 'RELATED', num: true },
    ],
  },
  {
    test: /^music charts/i,
    cols: [
      { key: 'rank', label: 'RANK', num: true },
      { key: 'track', label: 'TRACK', fallback: 'title', dot: true, keep: true },
      { key: 'artist', label: 'ARTIST' },
      { key: 'album', label: 'ALBUM' },
    ],
  },
  {
    test: /^ott & studio intelligence$/i,
    cols: [
      { key: 'service', label: 'NAME', fallback: 'title', dot: true, keep: true },
      { key: 'kind', label: 'KIND', pill: true },
      { key: 'owner', label: 'OWNER' },
    ],
  },
  {
    test: /^celebrity influence index$/i,
    cols: [
      { key: 'person', label: 'PERSON', fallback: 'title', dot: true, keep: true },
      { key: 'followers', label: 'FOLLOWERS (WD)', num: true },
    ],
  },
];

export function feedColumns(feature, rows) {
  const preset = PRESETS.find((p) => p.test.test(feature || '') && (!p.onlyIf || p.onlyIf(rows || [])));
  if (preset) {
    const available = preset.cols.filter((c) => {
      if (c.keep) return true;
      return rows.some((r) => {
        const v = r[c.key];
        if (v != null && String(v).trim() !== '') return true;
        if (!c.fallback) return false;
        const f = r[c.fallback];
        return f != null && String(f).trim() !== '';
      });
    });
    // Mark first 7 as default; extras available via column chooser.
    return available.map((c, i) => ({ ...c, default: c.default !== false && i < 7 }));
  }
  const keys = displayColumns(rows).filter((k) => k !== 'source_url' && k !== 'reporting_search');
  return keys.map((k, i) => ({
    key: k,
    label: k.replace(/_/g, ' ').toUpperCase(),
    fallback: k === 'title' ? 'name' : '',
    dot: i === 0,
    default: i < 7,
  }));
}

export function cellOf(row, col) {
  const v = row[col.key];
  if (v != null && String(v).trim() !== '') return String(v);
  if (col.fallback && row[col.fallback] != null && String(row[col.fallback]).trim() !== '') {
    return String(row[col.fallback]);
  }
  return '';
}

/** All columns for a feature including optional ones (for the chooser). */
export function feedAllColumns(feature, rows) {
  return feedColumns(feature, rows);
}
