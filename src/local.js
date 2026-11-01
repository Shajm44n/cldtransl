// Offline helpers that need no model: glossary corrections, Japanese
// business-culture hints and a ready-made phrasebook.

// Glossary lines like "Axia => Acsia" fix words speech recognition gets wrong.
export function glossaryReplacements(context) {
  return (context || '')
    .split('\n')
    .map((line) => line.split('=>').map((s) => s.trim()))
    .filter((parts) => parts.length === 2 && parts[0] && parts[1]);
}

export function applyGlossary(text, context) {
  let out = text;
  for (const [from, to] of glossaryReplacements(context)) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ascii = /^[\x20-\x7e]+$/.test(from);
    out = out.replace(new RegExp(ascii ? `\\b${escaped}\\b` : escaped, ascii ? 'gi' : 'g'), to);
  }
  return out;
}

const JA_HINTS = [
  [/前向きに検討|検討(させて|いたし|し)ます|検討します/, '"We will consider it" is often a polite "not now" or "no". Ask gently about next steps and a timeline.'],
  [/難しい|厳しい/, '"That is difficult" usually means no in Japanese business. Don\'t push; ask what would make it possible.'],
  [/ちょっと[、。…]*$/, 'A sentence trailing off with "chotto…" is a soft refusal.'],
  [/持ち帰|社内で(確認|相談|調整|検討)|上(の者|司)と(相談|確認)/, 'They will take it back for internal consensus (nemawashi / ringi). Decisions take time; offer materials such as case studies to help them.'],
  [/前例/, 'Lack of a precedent is a real concern. Mention reference cases (e.g. the European and US Tier 1 results).'],
  [/品質|信頼性/, 'Quality is paramount. Stress verification, engineer approval gates and traceability.'],
  [/セキュリティ|情報漏え?洩|機密|クラウド|社外/, 'Data confidentiality concern. LiLA runs on-premise or air-gapped; data never leaves their company.'],
  [/いかがでしょうか|いかがですか/, 'A polite way to ask for your opinion or to suggest something.'],
  [/恐れ入りますが|申し訳(ございません|ありません)が|あいにく/, 'Polite cushion phrase: a request or refusal follows.'],
  [/(部長|課長|社長|本部長|役員|室長|主任)/, 'Job title mentioned: address people as surname + title or surname + san, and defer to the senior person.'],
  [/すみません|申し訳/, 'Apologies are often social courtesy, not an admission of fault.'],
];

const EN_HINTS = [
  [/\b(no|can't|cannot|won't|impossible)\b/i, 'A direct "no" can sound harsh in Japanese. Consider "それは少し難しいかもしれません" (sore wa sukoshi muzukashii kamoshiremasen).'],
  [/\byou (must|should|need to|have to)\b/i, 'Instructions can sound pushy. Prefer "～していただけますでしょうか" (could you kindly…).'],
  [/\b(cheap|cheaper|price|discount)\b/i, 'Talk about value and total effort saved rather than price alone.'],
  [/\b(fast|quick|asap|urgent)\b/i, 'Japanese partners value thoroughness. Pair speed with how quality is assured.'],
];

export function cultureHints(text, lang) {
  const rules = lang === 'ja' ? JA_HINTS : EN_HINTS;
  return rules.filter(([re]) => re.test(text)).map(([, hint]) => hint).join(' ');
}

export const PHRASEBOOK = [
  {
    title: 'Greetings & business cards',
    phrases: [
      ['はじめまして。アクシアから参りました。よろしくお願いいたします。', 'Hajimemashite. Akushia kara mairimashita. Yoroshiku onegai itashimasu.', 'Nice to meet you. I am from Acsia. I look forward to working with you.'],
      ['こちらが私の名刺です。', 'Kochira ga watashi no meishi desu.', 'Here is my business card.'],
      ['名刺を頂戴いたします。', 'Meishi o chōdai itashimasu.', 'Thank you, I will gladly take your card.'],
      ['本日はお時間をいただき、ありがとうございます。', 'Honjitsu wa o-jikan o itadaki, arigatō gozaimasu.', 'Thank you for your time today.'],
    ],
  },
  {
    title: 'In the meeting',
    phrases: [
      ['もう一度、ゆっくりお願いできますか。', 'Mō ichido, yukkuri onegai dekimasu ka.', 'Could you say that again slowly?'],
      ['申し訳ございません。日本語が十分ではないので、翻訳アプリを使ってもよろしいでしょうか。', 'Mōshiwake gozaimasen. Nihongo ga jūbun de wa nai node, hon\'yaku apuri o tsukatte mo yoroshii deshō ka.', 'Sorry, my Japanese is limited. May I use a translation app?'],
      ['少し確認させてください。', 'Sukoshi kakunin sasete kudasai.', 'Please let me confirm something.'],
      ['ご質問はございますか。', 'Go-shitsumon wa gozaimasu ka.', 'Do you have any questions?'],
      ['持ち帰って社内で検討いたします。', 'Mochikaette shanai de kentō itashimasu.', 'I will take this back and discuss it internally.'],
      ['後ほどメールで資料をお送りいたします。', 'Nochihodo mēru de shiryō o o-okuri itashimasu.', 'I will send you the materials by email later.'],
    ],
  },
  {
    title: 'Introducing LiLA',
    phrases: [
      ['LiLAは、自動車ソフトウェア開発のためのエージェント型AIプラットフォームです。', 'Lila wa, jidōsha sofutowea kaihatsu no tame no ējento-gata AI purattofōmu desu.', 'LiLA is an agentic AI platform for automotive software development.'],
      ['要件定義、サイバーセキュリティ、コード検証、テストの4つのフローがあります。', 'Yōken teigi, saibā sekyuriti, kōdo kenshō, tesuto no yottsu no furō ga arimasu.', 'It has four flows: requirements, cybersecurity, code verification and testing.'],
      ['SpecFlowは、OEMの仕様書から要件を抽出し、分類します。日本語の仕様書にもそのまま対応しています。', 'SpecFlow wa, OEM no shiyōsho kara yōken o chūshutsu shi, bunrui shimasu. Nihongo no shiyōsho ni mo sonomama taiō shite imasu.', 'SpecFlow extracts and classifies requirements from OEM specifications, including Japanese ones, without a translation step.'],
      ['SafeFlowは、ISO/SAE 21434とUN R155に沿ったTARAとペネトレーションテスト計画を、約1週間で作成します。', 'SafeFlow wa, ISO/SAE 21434 to UN R155 ni sotta TARA to penetorēshon tesuto keikaku o, yaku isshūkan de sakusei shimasu.', 'SafeFlow produces the TARA and pentest plan to ISO/SAE 21434 and UN R155 in about one week.'],
      ['CodeFlowは、VS Code上で単体テスト、MISRA C:2023のチェック、Doxygenのドキュメントを生成します。', 'CodeFlow wa, VS Code-jō de tantai tesuto, MISRA C:2023 no chekku, Doxygen no dokyumento o seisei shimasu.', 'CodeFlow generates unit tests, MISRA C:2023 checks and Doxygen documentation inside VS Code.'],
      ['TestFlowは、要件からテストケースとスクリプトを作成し、実機で検証して合否を判定します。', 'TestFlow wa, yōken kara tesuto kēsu to sukuriputo o sakusei shi, jikki de kenshō shite gōhi o hantei shimasu.', 'TestFlow creates test cases and scripts from requirements, runs them on real hardware and gives pass/fail verdicts.'],
      ['すべてお客様のサーバー上で動作し、データが社外に出ることはありません。', 'Subete okyakusama no sābā-jō de dōsa shi, dēta ga shagai ni deru koto wa arimasen.', 'Everything runs on your own servers; your data never leaves your company.'],
      ['最終的な判断は、常にエンジニアが行います。', 'Saishūteki na handan wa, tsune ni enjinia ga okonaimasu.', 'Engineers always make the final decision.'],
      ['欧州のTier 1のお客様では、要件分析の工数を66%削減しました。', 'Ōshū no tiā wan no okyakusama de wa, yōken bunseki no kōsū o rokujūroku pāsento sakugen shimashita.', 'At a European Tier 1 customer, we cut requirements analysis effort by 66%.'],
      ['まずは優先度の高いユースケース1つで、2か月間の取り組みから始めることをご提案します。', 'Mazu wa yūsendo no takai yūsu kēsu hitotsu de, nikagetsukan no torikumi kara hajimeru koto o go-teian shimasu.', 'We suggest starting with a two-month engagement on one high-priority use case.'],
      ['どのフローに最もご関心がありますか。', 'Dono furō ni mottomo go-kanshin ga arimasu ka.', 'Which flow interests you most?'],
    ],
  },
  {
    title: 'Closing',
    phrases: [
      ['本日はありがとうございました。今後ともよろしくお願いいたします。', 'Honjitsu wa arigatō gozaimashita. Kongo tomo yoroshiku onegai itashimasu.', 'Thank you for today. We look forward to working with you.'],
      ['次のステップについて、ご相談させていただけますか。', 'Tsugi no suteppu ni tsuite, go-sōdan sasete itadakemasu ka.', 'Could we discuss the next steps?'],
    ],
  },
];
