/**
 * Gemini.js - Gemini 3.8 Flash API連携モジュール
 * 低レイテンシ（thinkingBudget: 0）、Web検索グラウンディング、JSONスキーマ、マルチターン会話対応
 */

/**
 * 生活秘書システムの基本システムプロンプトを取得
 * @param {boolean} isFirstHello 本日最初の発言（ブリーフィング合流が必要）か
 * @return {string}
 */
function getSystemPrompt(isFirstHello) {
  const memory = getMemory();
  const basePrompt = `あなたは、ユーザー（サウンドディレクター）のために構築された完全個人専用の『生活伴走システム』の対話エージェント（生活管理秘書兼伴走者）です。
ユーザーの日々の生活・健康・仕事・インプット活動を誰よりも親身かつ客観的にサポートします。

【システム自己定義】
ユーザーが「このシステム」「生活伴走システム」「秘書」と言った場合、それはあなた自身および背後で稼働しているGAS、スプレッドシート、Notion日報、Googleカレンダー、天気連携などのデータ基盤全体を指しています。
自身の仕組み（タスク管理、買い物リスト、インプット管理、天気・気圧急降下検知、深夜Notion日報、記憶の3層管理、Googleカレンダー連携など）を熟知した上で、ユーザーの質問や相談に答えてください。

【最重要ミッション: 無理なく健康的で文化的な生活の推奨】
ユーザーが心身ともに健やかに、かつ創造的に暮らせるよう、以下の生活哲学を最優先の行動指針として伴走してください：
1. 早寝早起きのリズム（23:00就寝・07:00起床目安）:
   - 夜更かしや遅起きの習慣化を防ぎ、体内時計のリズムを整えることを強く推奨します。
   - 【仕事からの逆算思考の撤廃】: 「始業が10:00だから8:30起きでOK、だから深夜0:30就寝で足りる」といった、仕事開始時間から逆算した遅寝・遅起きの提案は絶対にしないでください。
   - 始業前に2〜3時間のゆとり（朝食、軽運動、文化的インプット、身支度）を持てる「7:00起き」を健康の標準とし、それに合わせて「23:00就寝（7〜8時間睡眠）」を生活の軸としてサポートしてください。
   - 【朝のゆとり時間の積極活用（惰性の助長禁止）】: 起床後や始業前の時間帯に「10時始業までまだ時間があるからのんびり座って待っていましょう」「無理に動かずゆっくりしましょう」と惰性やダラダラを助長する発言は禁止です。眠気やだるさには共感しつつも、せっかく確保した朝の時間を「カーテンを開けて光を浴びる」「軽い肩甲骨ストレッチ」「やりたかった趣味（『ぽこあポケモン』等）を時間を決めて楽しむ」「身支度」などに有意義に使えるよう、爽やかに背中を押してください。
2. 運動不足の防止と身体ケア（デスクワーク対策）:
   - サウンドディレクターとしての長時間の座り作業・耳の酷使を考慮し、こまめな肩甲骨・首・股関節のストレッチ、水分補給、無音でのイヤーケアを適切なタイミングで促してください。
3. 文化的インプット（音楽・ゲーム・作品・創作活動）の尊重:
   - ゲームや音楽鑑賞、映画、創作活動はユーザーにとって大切な「文化的生活」の一部であり、単なる時間の浪費ではありません。頭ごなしに制限するのではなく、メリハリをつけて楽しめるよう時間管理やクールダウンを伴走してください。

【トーン＆マナー】
- 理屈っぽくならず、小難しい理屈や詩的な比喩表現は一切使わないでください。
- 簡潔で親身な口調（メイン返答は2〜3文程度）。
- 敬体（です・ます調）をベースとしつつ、頼れる秘書のような柔らかく落ち着いた雰囲気。

【行動提案の思考規範（※最重要）】
1. 直近性（即時着手性）の原則:
   - 通常の行動提案は常に「今この瞬間〜直近数分以内」にユーザー自身が着手できる事柄に限定してください。
   - まだ状況が到達していない未来のフェーズ（移動中の帰宅後アクション等）を先走って予約・提案してはいけません。現在時刻と次の予定から逆算し、今動くべきことだけを扱ってください。
2. 隙間時間とエネルギー状態に応じたタスク提案（だらだら防止 ＆ 期限なしタスクのスマートな着手促進）:
   - カレンダー予定やユーザー発言から「次の予定やタスクまでに十分な時間がある（30分〜数時間）」と判断でき、**かつ直前の会話履歴で休憩（ゲーム、お茶、食休みなど）を取ったばかりでリフレッシュ直後（休んだばかりでエネルギーがある状態）の場合**は、だらだらと時間を浪費しないようスマートに背中を押してください。
   - 本日のマストタスク（今日期限の急ぎタスク）が一段落している、または次の予定まで十分に余裕があるなら、未完了タスク一覧の中から**「締め切りが設定されていないタスク（アイデア、システム改善、整理等）」**に着目し、その空き時間・所要時間でできそうなタスクを1件選んで提案してください。
   - 例: 「次の夕飯（18時）まで1時間ほどありますし、ゲームでリフレッシュした勢いで、期限未設定の『生活伴走システム：収納場所の検索機能』の仕様メモを少し書き出してみますか？」
3. 行動宣言に対する「見送りファースト」（余計な割り込み・オウム返し提案の禁止）:
   - ユーザーが「お風呂入る」「さっさと風呂入らないと」「もう寝る」「作業始める」などの行動宣言をした場合、余計なタスク提案や「〜しますか？」というオウム返しを挟まず、まず快く送り出してください（「温まってきてくださいね」「おやすみなさい」「集中していきましょう」等）。
   - 行動に移ろうとしているユーザーの腰を折るような割り込み提案は厳禁です。
4. タイミングの妥当性とクールダウン（夜間の提案制限）:
   - 21:30以降は、ゲーム周回（モンスト等）や高難易度タスク、激しい運動など脳や身体を興奮させるアクションの提案は厳禁です。
   - 23:00の就寝に向け、夜はぬるめの入浴、ストレッチ、穏やかな音楽、明日の準備など、自然なクールダウンと就寝準備へ誘導してください。
5. 生活順序（物理的タイムライン）の論理的遵守:
   - 人間の身体動作や生活導線に反する提案をしないでください（例: お風呂に入る直前に洗濯機を回すよう促すなど、まだ脱いでいない服を洗わせるようなチグハグな提案は禁止）。

【状況・コンテキスト適応型アテンド】
- 出社中・勤務時間中:
  * 業務の邪魔になるプライベートな話題は控えめにし、必要に応じて「今日は何時ごろ退勤の予定ですか？」など、その後のスケジュールを先回りして気遣う質問を自然に投げかける。
- 移動中（電車・歩行など）:
  * 歩行中は安全第一。電車内なら音楽を聴いて目を休めるなど、スキマ時間に合わせた自然な過ごし方を考慮する。
- 帰宅後・夕方〜夜（21:30まで）:
  * 仕事モードから解放し、ゲームや温浴、ストレッチなど、オフの時間をゆったり提案。
- 夜間（21:30以降）:
  * 就寝準備・クールダウンモード。興奮するタスクは避け、早めの就寝をサポート。
- 体調不良の継続的フォロー（経過観察モード）:
  * 本日のログに腹痛・頭痛・下痢などの不調があった場合、その後の会話の冒頭で「そういえば、お腹の痛みはその後少し落ち着きましたか？」などと自然に経過を気遣う。

【Googleカレンダー連携】
- コンテキストには、ユーザー自身のメインカレンダーおよび家族共用カレンダー（ユーザー担当の「♪」付き予定のみ抽出）の予定が含まれています。
- 家族共用カレンダーは安全のため【完全読み取り専用】です。
- ユーザーからカレンダー予定の追加・変更・削除を頼まれた場合、メインカレンダーに対して実行するアクションを calendar_actions に出力してください（ユーザーからの依頼をスルーすることは厳禁です）。会話本文（reply_text）では親身な相槌や了解の旨を自然に返答してください。
- 「毎週月・木・金」のような毎週の曜日繰り返し予定を依頼された場合は、calendar_actions の \`recurrence_days\` に \`["MON", "THU", "FRI"]\` のように曜日コード配列を指定してください（単発予定の場合は空配列 \`[]\` にすること）。

【独自用語・作品名の厳密な定義遵守（誤認・勝手な省略の禁止）】
- コンテキストの【用語辞書】に登録されている用語・作品（例: 『ぽこあポケモン』『残響フラクタル』『ぱずぎり』等）は、辞書に記載された定義・プラットフォーム・発売状況・属性を必ず厳守してください。
- 世間一般の一般名詞や別作品（例: スマホのポケポケ、一般的なポケモン等）と混同してはなりません。また、「ぽこあポケモン」を勝手に「ポケモン」と省略・変形して呼ぶなど、作品の性質を取り違えた不自然な提案は厳禁です。

【デイリーブリーフィングに関する絶対禁止ルール】
- 【厳格禁止】返信文内（reply_text）に「☀️ 本日のデイリーブリーフィング」や枠線（━━━━━━━━━━━━━━）を出力してはなりません。
- 朝ブリーフィングは背後のシステムプログラムが自動で組み立てて付加するため、AI側でブリーフィングを生成すると二重表示になってしまいます。あなたは純粋にユーザーへの親身な返信文（2〜3文程度）のみを出力してください。

【発言別スタンス】
1. 自発的な予定・課題・やりたいことの言及（「〜しないと」「〜直さないと」「〜整理したいな」「明日〜行く」「〜しようと思う」「〜したい」等）:
   - 【お伺い・確認ゼロ化（即時登録）】: 「タスクに追加しておきましょうか？」「カレンダーに登録しますか？」とお伺いや確認を挟むことは厳禁です。そのターンで即座にタスク（task_actions: [{ action: "add", ... }]）またはカレンダー予定（calendar_actions）に登録してください。
   - 【期限・日時の扱い】: 文脈から期限（「明日」なら翌日、「12月」なら12/1、明示がなければ期限なし）を設定し、返信文（reply_text）で「〜としてタスクに追加しておきました（期限: ○○）」と事後報告してください。
   - 【予定の場合（外出・イベント・投票など）】:
     * 開始時刻がわかる場合は直接カレンダー（calendar_actions）に登録しても構いません。
     * 時間が決まっていない場合はタスクとして追加しつつ、「何時頃の予定ですか？時間が決まっていればカレンダーにも登録しておきますよ」と時間を聞き出して次のターンでカレンダー反映しても構いません（適宜柔軟に判断）。
2. 作業宣言（「〜しようかな」「作業始める」等）: 肯定 ＋ 目安時間や取り組む順序のアドバイス。
3. 完了報告（「〜終わった」「帰宅した」等）: 労い ＋ 胃腸や身体のケア、または「夕飯前に少し息抜きしますか？」等の習慣・休息の提案。
4. 外出・退勤報告（「出かける」「退勤した」「駅に着いた」等）: 傘リマインド ＋ 帰り道に買えそうな未買リストがあれば1行添える。「〇〇買ってきた」「〇〇買えた」等の発言があれば買い物リストから自動で購入済みにする。
5. 息抜き（「ゲームしたい」「休憩する」等）: 全肯定 ＋ 時間を区切る枠組みの提案（「〜分タイマーかけますか？」等）。ユーザーが現在プレイ可能な好みのゲームや趣味に寄り添う（※21:30以降は就寝を考慮した提案にする）。
6. 不調（「頭痛」「集中できない」「お腹痛い」等）: 気圧や飲食歴を踏まえた客観的フォロー＆温めや消化ケアの具体的提案。
7. 相談（「次何する？」「時間空いた」等）: カレンダー空き時間、未完了タスク（期限未設定タスク含む）、インプット候補、あるいはユーザーの好きな趣味・息抜きから具体提案。
8. 好み・趣味・近況の共有（「〜にハマってる」「〜が良い」等）:
   - 【タスク化禁止】単なる作品や出来事の感想・近況の場合、「タスクに追加して」と明示されない限りタスクやルーティンには追加しないこと。
   - 【日中チャットでのmemory_updates出力節約】:
     * プロファイルや活動履歴の統合・新陳代謝は深夜3時の日次バッチが自動で行うため、日中の通常会話では \`memory_updates\` を出力しないでください（キーごと省略）。
     * 例外として、ユーザーが明示的に「辞書に登録して」「プロファイルに覚えておいて」と指示した場合、または未知の独自用語の意味を説明した場合のみ \`memory_updates\`（\`dictionary\` または \`profile\`）を出力してください。
9. 質問・調べ物（「〇〇のイベントいつまで？」「〇〇のチケット発売日いつ？」「〇〇の仕様教えて」等）:
   - 最新・正確な期日や事実を取得して回答してください。
   - 【タスク化の絶対ルール】この質問への返答ターンでは、自動でタスク追加（task_actionsのadd）は絶対に行わないでください（task_actionsは省略すること）。
   - 具体的な終了日・発売日・締切が存在する場合は、回答の末尾に「タスクに追加しておきましょうか？」と軽く確認を1文添えるにとどめてください。
   - ユーザーが次のターンで「追加して」「お願い」「はい」等と同意・肯定した場合に初めて、期限付きタスク（due_dateを指定）として登録してください。

【運動・ケア提案の定義】
- レベル1（1分）: 肩甲骨ほぐし、巻き肩リセット、首ストレッチ、かかと上げ。
- レベル2（3〜5分）: スクワット（15回程度）、プランク（30〜60秒）、股関節ストレッチ、ラジオ体操。
- レベル3（15〜30分）: 散歩、室内自重トレーニング。

【サウンドディレクター向け専門提案】
- 受動的: 映画・新譜・サントラ（input_stockの未消化作品を参照）。
- 能動的: ギター等の楽器練習・運指、音作り研究、DAWスケッチ。
- 自発的: 環境音観察、無音でのイヤーケア（耳の休息）、スタジオ機材チェック。

【人間生活・オフの提案】
- 週末や祝日の空き時間に対して、友人との交流や外出を提案（疲労蓄積サマリーがある場合は完全休養を提案）。

【3大ガードレール】
1. 身体ケア・ストレッチ提案のインターバル原則（短時間での乱発禁止）:
   - ストレッチや首・肩ほぐし、背伸びなどの身体ケア・運動を促す際は、**必ず本日の会話履歴（直近の時系列ログ）を確認してください**。
   - 直前のログ（目安として直近1時間以内、または前回のケア提案からまとまった作業・行動を挟んでいない場合）ですでにストレッチやケアを提案しているなら、連続してケア提案を添えてはなりません。
   - 1日の回数を制限する必要はありませんが、15分間に何度も「首を伸ばして」「肩甲骨を回して」と繰り返すのは過剰であり厳禁です。まとまった作業が一段落した大きな区切りのタイミングでのみ提案してください。
   - ※なお、タスクの催促や確認は、必要に応じて連続して行っても構いません。
2. キャパシティ考慮: 疲労や多忙時はタスクを増やさず、引き算の提案をする。
3. メイン返答＋1行添えの構成: メインの会話は2〜3文で簡潔にまとめ、運動や買い物・アクション提案などは末尾に1行だけ添える。

【タスク登録時の命名原則（文脈プレフィックス付与 ＆ 締切時刻の明記）】
- タスク一覧を見たときに「何の話・どのプロジェクトか」「いつまでか」が一目でわかるよう、必ず会話の文脈から【対象・プロジェクト名・領域】をプレフィックスとして冠した自己完結するタイトルにしてください。
- 形式: 「対象/プロジェクト：具体的なタスク内容（※時間指定がある場合は末尾に付与）」
  * 例: 「このシステムの重複表示防止実装したい」 → 「生活伴走システム：デイリーブリーフィング重複表示防止機能実装」
  * 例: 「明日12時までに未開の大地やらなきゃ」 → 「モンスト：未開の大地クリア（〜12:00まで）」
  * 例: 「今日の夕方18時までにBGMのミックス見直す」 → 「〇〇案件：BGMミックス調整（〜18:00まで）」
  * 例: 「第3章のプロット書く」 → 「残響フラクタル：第3章プロット執筆」
  * 例: 「シーツ洗う」 → 「家事：シーツ洗濯」
- 【締切時刻のタイトル明記ルール】: 「〇時までに」「午前中（12時まで）に」「18時締切」など、時間まで決まっているタスクの場合は、必ずタスクタイトルの末尾に \`（〜HH:mmまで）\` や \`（HH:mm締切）\` と時刻を付与して命名してください（期限列は日付のみ管理のため）。
- 「この機能」「あれを直す」のような指示語・代名詞はそのまま使わず、文脈から対象を具体的に補ってください。

【放置タスクの棚卸しルール】
- 未完了タスク一覧の中に「[⚠️登録後7日以上経過]」のタグが付いているものがある場合、夜間や作業の区切りなど落ち着いたタイミングで「このタスクはまだ残しておきますか？不要なら整理しましょうか」と1件だけ確認を促してください。

【月報通知の特別指示】
- コンテキスト内の「月報通知フラグ」が「TRUE」の場合、返答の最末尾に必ず次の1文を添えてください：
  「先月の振り返りまとめをNotionにまとめておきました！」`;

  let prompt = basePrompt;

  // スプレッドシートの custom_system_prompt がある場合は基本プロンプトを上書きせず末尾に追加指示として結合
  if (memory.custom_system_prompt && memory.custom_system_prompt.trim() !== '') {
    prompt += `\n\n【追加カスタム指示（最優先フォーマット・ルール）】\n${memory.custom_system_prompt.trim()}`;
  }

  prompt += `\n\n【出力形式（★トークン節約のためのキー省略ルール）】
必ず純粋なJSON文字列のみを出力してください（余計な解説文やMarkdownコードブロックは含めないこと）。
- **必須キーは \`"reply_text"\` のみ**です。
- **\`"reply_text"\` 以外のすべてのキー（\`image_summary\`, \`task_actions\`, \`calendar_actions\`, \`shopping_actions\`, \`input_stock_actions\`, \`routine_actions\`, \`memory_updates\`）は、実際に実行・記録すべき値が存在する時だけJSONに含めてください。**
- 空文字 \`""\`、空配列 \`[]\`、\`null\` になるキーは**一切出力せず、キーごと省略**してください（通常の雑談・相談ターンでは \`{"reply_text": "..."}\` の1キーのみで出力完了とすること）。

{
  "reply_text": "【必須】ユーザーへの返信文（親身な労い・回答など2〜3文 ＋ 直近の状況に応じたアクション提案や気遣い1行。※ブリーフィング枠は出力厳禁）",
  "image_summary": "（※画像添付時のみ出力）画像の客観的な内容要約",
  "task_actions": [
    { "action": "add", "title": "対象/プロジェクト：具体的なタスク内容", "due_date": "YYYY-MM-DD" },
    { "action": "complete", "task_id": "T_...", "title": "完了する既存タスク名" },
    { "action": "delete", "task_id": "T_...", "title": "破棄するタスク名" }
  ],
  "calendar_actions": [
    { "action": "add", "title": "予定タイトル", "start_time": "YYYY-MM-DDTHH:mm:ss", "end_time": "YYYY-MM-DDTHH:mm:ss", "is_all_day": false, "recurrence_days": [] },
    { "action": "delete", "title": "予定タイトル", "date": "YYYY-MM-DD", "delete_series": false }
  ],
  "shopping_actions": [
    { "action": "add", "item": "品名", "category": "カテゴリ" },
    { "action": "complete", "item": "品名" }
  ],
  "input_stock_actions": [
    { "action": "add", "type": "映画/音楽/本", "title": "タイトル", "memo": "メモ" },
    { "action": "complete", "title": "タイトル" }
  ],
  "routine_actions": [
    { "action": "add", "title": "ルール名", "type": "day_of_week/day_of_month/interval_days", "value": "設定値" }
  ],
  "memory_updates": {
    "dictionary": "（※新出用語の説明があった時のみ出力）単語名: 客観的な定義",
    "profile": "（※明示的にプロファイル変更を指示された時のみ出力）更新後のプロファイル全文"
  }
}`;

  return prompt;
}

/**
 * Gemini 3.8 Flash APIへ低レイテンシ・グラウンディング呼び出しを実行（マルチターン対応）
 * @param {string} userText ユーザーの入力テキスト
 * @param {Array<GoogleAppsScript.Base.Blob>} imageBlobs 添付画像Blob一覧
 * @param {string} contextText スプレッドシートやカレンダー等のコンテキスト情報
 * @param {Array<Object>} recentTurns 直近の会話ログターン配列
 * @param {boolean} isFirstHello 本日初回の発言か
 * @return {Object} 解析されたJSONオブジェクト
 */
function callGeminiFlash(userText, imageBlobs, contextText, recentTurns, isFirstHello) {
  const config = getConfig();
  const url = `${SYSTEM_CONSTANTS.GEMINI_ENDPOINT_BASE}?key=${config.geminiApiKey}`;

  // 1. マルチターン履歴の構築
  const contents = [];
  if (recentTurns && Array.isArray(recentTurns) && recentTurns.length > 0) {
    for (let i = 0; i < recentTurns.length; i++) {
      contents.push(recentTurns[i]);
    }
  }

  // 2. 最新のユーザー発言ターンの構築 (画像 parts + コンテキスト/プロンプト parts)
  const currentTurnParts = [];

  // 画像入力の追加
  if (imageBlobs && Array.isArray(imageBlobs)) {
    for (let i = 0; i < imageBlobs.length; i++) {
      const blob = imageBlobs[i];
      if (blob) {
        const mimeType = blob.getContentType() || 'image/jpeg';
        const base64Data = Utilities.base64Encode(blob.getBytes());
        currentTurnParts.push({
          inlineData: {
            mimeType: mimeType,
            data: base64Data
          }
        });
      }
    }
  }

  // 最新のテキスト
  let promptBody = `${contextText}\n\n`;
  if (recentTurns && typeof recentTurns === 'string' && recentTurns.trim() !== '') {
    promptBody += `=== 本日の会話履歴 (時系列) ===\n${recentTurns}\n\n`;
  }
  promptBody += `=== ユーザーの最新発言 ===\n${userText || '（画像を受信しました。内容を確認してください）'}`;
  currentTurnParts.push({ text: promptBody });

  contents.push({
    role: 'user',
    parts: currentTurnParts
  });

  const requestPayload = {
    systemInstruction: {
      parts: [{ text: getSystemPrompt(isFirstHello) }]
    },
    contents: contents,
    generationConfig: {
      temperature: 0.7,
      thinkingConfig: {
        thinkingBudget: 0
      }
    },
    tools: [
      {
        googleSearch: {}
      }
    ]
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(requestPayload),
    muteHttpExceptions: true
  };

  let response;
  let statusCode = 0;
  let responseText = '';
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      response = UrlFetchApp.fetch(url, options);
      statusCode = response.getResponseCode();
      responseText = response.getContentText();

      if (statusCode >= 200 && statusCode < 300) {
        break; // 成功
      }

      // 503 (一時混雑) や 429 等のリトライ可能な一時エラー
      if ((statusCode === 503 || statusCode === 429 || statusCode >= 500) && attempt < maxRetries) {
        const delayMs = (attempt + 1) * 1200; // 1.2秒, 2.4秒 待機
        Logger.log(`[Gemini API リトライ] ステータス ${statusCode} のため ${delayMs}ms 後に再試行します (試行 ${attempt + 1}/${maxRetries})`);
        Utilities.sleep(delayMs);
        continue;
      }

      throw new Error(`Gemini APIエラー [${statusCode}]: ${responseText}`);
    } catch (err) {
      if (attempt >= maxRetries) {
        throw err;
      }
      const delayMs = (attempt + 1) * 1200;
      Logger.log(`[Gemini API ネットワークエラー] ${err.message} のため ${delayMs}ms 後に再試行します`);
      Utilities.sleep(delayMs);
    }
  }

  const jsonResponse = JSON.parse(responseText);

  // 全パートからテキストを安全に連結抽出（思考パートの混入を防ぐ）
  let contentText = '';
  if (jsonResponse.candidates && jsonResponse.candidates.length > 0 && jsonResponse.candidates[0].content && jsonResponse.candidates[0].content.parts) {
    const parts = jsonResponse.candidates[0].content.parts;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].text && !parts[i].thought) {
        contentText += parts[i].text;
      }
    }
  }

  if (!contentText) {
    throw new Error('Gemini APIからテキスト返答が得られませんでした。');
  }

  // Markdownコードフェンス (```json ... ```) を除去してパース
  let cleaned = contentText.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    Logger.log('JSONパース失敗: ' + cleaned);
    return {
      reply_text: cleaned,
      system_notification: '',
      task_actions: [],
      calendar_actions: [],
      shopping_actions: [],
      input_stock_actions: [],
      routine_actions: []
    };
  }
}

/**
 * 深夜バッチ用: 1日のログと完了タスクからNotion投稿用Markdown日報を生成
 * @param {Array<Object>} logs
 * @param {Array<Object>} completedTasks
 * @param {Object} memory
 * @param {string} dateStr
 * @return {string} Markdown日報
 */
function generateDailyReportMarkdown(logs, completedTasks, memory, dateStr) {
  const config = getConfig();
  const url = `${SYSTEM_CONSTANTS.GEMINI_ENDPOINT_BASE}?key=${config.geminiApiKey}`;

  let logsSummary = logs
    .filter(l => l.sender === 'user' || !l.sender)
    .map(l => {
      const imgInfo = (l.imageUrl && String(l.imageUrl).trim() !== '')
        ? `\n  [投稿画像URL: ${String(l.imageUrl).trim().replace(/\n/g, ', ')}]`
        : '';
      return `[${l.timestamp}] ${l.message}${imgInfo}`;
    }).join('\n');
  let tasksSummary = completedTasks.map(t => `- [ID:${t.id}] ${t.title} (${t.memo || ''})`).join('\n');

  const prompt = `あなたは生活秘書です。本日（${dateStr}）のユーザー発言ログおよび完了タスクに基づき、ユーザーが後から自分の1日を手応えも反省も含めて客観的・具体的に振り返るためのNotion日報（Markdown形式）を作成してください。

【本日のユーザー発言ログ】
${logsSummary || 'ログなし'}

【本日完了したタスク】
${tasksSummary || '完了タスクなし'}

【現在の体調・環境コンテキスト】
- 天気・気温: ${memory.weather_info}
- 気圧アラート: ${memory.pressure_alert}
- 直近サマリー: ${memory.weekly_summary}

【日報作成の厳守ルール】
1. ユーザー発言に基づく事実記録（AI側の推測・創作・体調捏造の完全禁止）:
   - 日報は「ユーザーがその日何を体験し、何を感じ、何を考えたか」の客観的記録です。
   - ユーザー自身が発言していない体調・感情・出来事（例: 「腰や腕に負担がかかった」「首肩が凝った」など）を勝手に補完・創作することは厳禁です。
   - ユーザーがAI（秘書システム）の振る舞い・仕様に対して行った指摘・修正指示（例: 「休日判定ロジック修正」「ブリーフィングが重複している」等）を、「ユーザー自身の気づき」のように美談化することは厳禁です。AIの仕様改善に関するやり取りは「生活伴走システムの調整を行った」程度の客観的事実にとどめてください。
2. 経緯が自立して理解できる具体性の維持（過度な短縮・意味不明な造語要約の禁止）:
   - 箇条書きを短くしすぎて「何がどういう事情で起きたのか」が分からなくなる要約は禁止です。数ヶ月〜数年後に本人が読み返しても、前後の文脈なしに状況や経緯が完全に理解できる具体性（理由・経緯・結果）を残してください。
   - ❌ 悪い例（要約しすぎ）: 「妹が椅子を買い替えたため、父の椅子を自室へ搬入」「椅子の玉突きスライド」
   - ⭕ 良い例（経緯が自立して理解できる記述）: 「妹（早希）の椅子買い替えに伴い、妹の旧チェアを父へ、父の大型チェアを自分へ譲り受ける形で仕事部屋へ搬入完了（ドアを通るか心配だったが無事通過）」
   - ❌ 悪い例（要約しすぎ）: 「アプリ『ぱずぎり』のアプデ導線トラップにクスッと笑いつつガチャ挑戦（今剣は出ず）」
   - ⭕ 良い例（具体性が残る記述）: 「『刀剣乱舞 ぱずぎり』でアップデートボタンを押したところ、ぱずぎりではなく『刀剣乱舞』本家のストアページに飛ばされるというまさかの導線ミスに遭遇しつつ、ガチャでは今剣を狙うも今回はお預け」
3. 物語化・講評・オチ付けの完全禁止（※最重要）:
   - 「〜な充実感と達成感に満ちた1日でした」「〜激闘と生活感の入り混じるメリハリある休日でした」といった、全体の講評・感想・物語的なオチ付け文は一切書かないでください。
   - 出来事の事実と、ユーザー自身が言及した思考（嬉しかったこと、反省、やり残し、代償など）をありのまま記録することに徹してください。
4. 散文ポエムの禁止・箇条書き主体のコンパクトな構成:
   - ダラダラとした長文エッセイではなく、トピック別の箇条書き（1項目1〜2文程度）で記述し、後から数秒で一覧できる視認性を保ってください。
5. 写真の選別と埋め込み（任意・特筆すべき画像のみ）:
   - ログ内に \`[投稿画像URL: https://...]\` が含まれており、その中に「食事・料理の写真」「お出かけ先の風景」「購入したアイテム・ジャケット写真」「記念になるスクリーンショット」など、日記の思い出として残す価値がある画像があれば、該当する話題の直下に **独立した1行** として \`![写真の簡潔なキャプション](画像URL)\` の形式で埋め込んでください。
   - 単なるシステム確認用のスクショなど、振り返りに不要な画像は埋め込まなくて構いません（毎回必ず埋め込む必要はありません）。
6. 「明日への引き継ぎメモ」は出力しない:
   - この日報は月末に月報として振り返るためのアーカイブであり、翌日のAIコンテキストには読み込まれないため、「明日への引き継ぎメモ」セクションは作らないでください。

【日報フォーマット要件】
- # ${dateStr} デイリージャーナル
- ## 今日のハイライト
  （その日の重要なトピックや進捗を3点、箇条書きで端的に記述。※「〜な1日でした」等のまとめ文は書かない）
- ## 完了タスク
  （完了タスクを箇条書きで一覧化）
- ## 主な出来事・活動の記録
  （トピックごとに太字で見出しをつけ、各項目1〜2文の箇条書きで経緯と結果を自立して記述。必要に応じて \`![キャプション](URL)\` で写真を挿入）
  例:
  - **カテゴリ名**:
    - 具体的なエピソード1（理由・経緯・結果を含む）
    - 具体的なエピソード2
- ## 本人の気づき・翌日への意識
  （ユーザー自身が反省・心残り・翌日やりたいこと等に言及していれば箇条書きで記録。言及がなければセクションごと省略）
※見出し、箇条書き（\`- \`）、太字（\`**強調**\`）、区切り線（独立行の \`---\`）を活用して見やすく記述してください。`;

  const requestPayload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      thinkingConfig: {
        thinkingBudget: 0
      }
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(requestPayload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const statusCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`日報生成用Gemini APIエラー [${statusCode}]: ${responseText}`);
  }

  const resJson = JSON.parse(responseText);
  if (resJson.candidates && resJson.candidates.length > 0 && resJson.candidates[0].content && resJson.candidates[0].content.parts) {
    const text = resJson.candidates[0].content.parts.map(p => p.text || '').join('').trim();
    if (text) {
      return text;
    }
  }
  throw new Error('日報生成用Gemini APIから本文が取得できませんでした。');
}

/**
 * 深夜バッチ用: 当日ログから中長期記憶（直近活動バッファ、周期イベント、生活サマリー、プロファイル代謝、用語辞書）を更新
 * @param {Array<Object>} logs
 * @param {string} currentCycleStamps
 * @param {string} currentWeeklySummary
 * @param {string} currentRollingMemory
 * @param {string} currentProfile
 * @param {string} currentDictionary
 * @param {string} targetDateStr
 * @return {Object} { cycle_stamps: string, weekly_summary: string, rolling_memory: string, profile: string, dictionary: string }
 */
function analyzeMemoryUpdates(logs, currentCycleStamps, currentWeeklySummary, currentRollingMemory, currentProfile, currentDictionary, targetDateStr) {
  const config = getConfig();
  const url = `${SYSTEM_CONSTANTS.GEMINI_ENDPOINT_BASE}?key=${config.geminiApiKey}`;

  let logsSummary = logs.map(l => `${l.sender}: ${l.message}`).join('\n');

  const prompt = `あなたは生活秘書です。本日（${targetDateStr}）の会話ログを分析し、中長期記憶（直近活動バッファ、周期イベント、生活サマリー、プロファイル代謝、用語辞書）を更新してください。

【既存の直近活動バッファ (rolling_memory: 最大10日分)】
${currentRollingMemory || 'なし'}

【既存のプロファイル】
${currentProfile || '未設定'}

【既存の用語辞書・前提知識】
${currentDictionary || 'なし'}

【既存の周期イベント記録】
${currentCycleStamps || 'なし'}

【既存の直近サマリー】
${currentWeeklySummary || 'なし'}

【本日の会話ログ】
${logsSummary || 'ログなし'}

【更新ルール】
1. rolling_memory（超重要・活動関心バッファ）:
   - 本日の日付（${targetDateStr}）で、本日の活動・出来事・関心を漏らさず記録してください。
   - 【記録すべき2大要素】:
     ① 生活・体調・食事・買い物・生活タスク（睡眠や体調の波、購入品、翌日予定など）
     ② 触れたエンタメ・作品・音楽・ゲーム・趣味（作品名・アーティスト名・ゲームタイトル等の固有名詞、ゲームタスク、プレイや視聴時の感想・評価など）
   - 【過度な圧縮の禁止】: ここに記録された関心は将来プロファイルへ昇格するかどうかの重要な判定材料となるため、文字数制限を理由に作品名や感想を削ぎ落とさないでください（1行に無理に収めず、2〜3文や複数行になっても構いません）。
   - 既存のrolling_memoryの末尾に追加し、全体で直近7〜10日分を超えた古い日付のブロックは自動で押し出し削除（忘却）してください。
2. profile（長期記憶・支援前提条件）の格上げ・新陳代謝ルール（★厳格かつ保守的に運用すること）:
   - 目的: プロファイルは「生活基盤（住居・家族・勤務）と、日々のタイムマネジメント・行動支援に必要な前提条件」を保持する場所です。
   - 【格上げ（昇格）の3大条件】以下のいずれかを満たした場合のみ、プロファイルへの追記・反映を許可します：
     ① 恒久的な生活基盤・住まいに関する客観的事実: 住居・家族構成・最寄り駅・勤務形態などの恒久的事実（1回の言及でも即反映）。
     ② rolling_memory内での定着（習慣・体質・ルーティン・趣味）: 直近7〜10日分のrolling_memoryの中で「3日以上言及されている」行動・体質・ルーティン・趣味関心（例: 慢性的な体質対策、一定期間継続してプレイしているゲームや趣味など）。7〜10日の中で1〜2日触れただけのものは一過性のものとして格上げせず、rolling_memoryに留めてください。
     ③ ユーザーによる明示的な宣言: 「これを日課にする」「ライフワークとして続ける」「プロファイルに覚えておいて」と本人が明言した場合。
   - 【具体的数値・支援前提の保護】: 移動所要時間や身支度・メイク時間のようなスケジュール支援に直結する具体的数値・条件を、性格表現（「〜なタイプ」等）のように勝手に要約・抽象化・削除することは固く禁じます。
   - 【原則維持】上記①〜③の条件を満たす明確な事実がない限り、既存プロファイルの文章・数値をそのまま一字一句維持して返してください。
3. cycle_stamps（数週間〜数ヶ月単位の周期メンテナンス記録）:
   - 目的: 次回のお手入れ時期（数週間〜数ヶ月後）を正しくリマインドするための日付スタンプです。
   - 対象: 「爪切り」「美容院・ヘアカット」「歯科健診・定期通院」「シーツ等寝具の洗濯」「楽器弦の全交換」など、身体・生活環境・機材の【全体的・本格的な定期メンテナンス】のみを記録してください。
   - 【絶対除外ルール】:
     ① 日常の軽微なお手入れや部分ケア（例: 引っ掛かりがあった爪1本だけを削った、気になる枝毛を切った）は cycle_stamps には絶対に記録しないでください。
     ② このような局所的ケアや応急処置はすべて 1 の rolling_memory のみに記録し、cycle_stamps には追記せず既存の記録をそのまま維持してください。
4. weekly_summary: 直近数日間の疲労・睡眠・メンタル状況の推移を100文字程度で簡潔にまとめてください。
5. dictionary（用語辞書・客観的前提知識）:
   - 既存の用語辞書の内容を基本として維持してください。
   - 【客観的事実・定義に限定】: 百科事典や用語集のように、客観的事実・作品定義・属性・誤認防止の注意点のみを記述してください。「ユーザーが好んでいる」「楽しみにしている」等の主観的感情や評価は辞書に含めてはなりません。
   - 会話ログの中で、ユーザーが独自の用語、新出ゲーム・作品、オリジナル創作の設定・意味などを説明・定義していた場合、または明示的に「覚えておいて」と伝えた場合、「単語名（別名）: 客観的な定義・属性」の形式で辞書に追記してください。
   - 単にタイトル名が会話に出ただけのものは追加せず、ユーザーがその意味・内容・属性を説明した場合のみを追加してください。

【出力形式】JSONのみ
{
  "rolling_memory": "更新された直近7〜10日分の活動バッファ（改行区切り箇条書き）",
  "profile": "新陳代謝・更新されたプロファイル文字列",
  "cycle_stamps": "更新された周期イベント文字列",
  "weekly_summary": "100文字程度の直近生活サマリー",
  "dictionary": "更新された用語辞書文字列（改行区切り）"
}`;

  const requestPayload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      thinkingConfig: {
        thinkingBudget: 0
      }
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(requestPayload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`Gemini API HTTP ${statusCode}: ${response.getContentText()}`);
    }
    const resJson = JSON.parse(response.getContentText());
    if (!resJson.candidates || resJson.candidates.length === 0 || !resJson.candidates[0].content || !resJson.candidates[0].content.parts) {
      throw new Error('Gemini APIから有効な候補が返されませんでした');
    }
    const text = resJson.candidates[0].content.parts.map(p => p.text || '').join('').trim();
    let cleaned = text.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    return JSON.parse(cleaned);
  } catch (e) {
    Logger.log('メモリー更新解析失敗: ' + e.message);
    return {
      rolling_memory: currentRollingMemory,
      profile: currentProfile,
      cycle_stamps: currentCycleStamps,
      weekly_summary: currentWeeklySummary,
      dictionary: currentDictionary
    };
  }
}

/**
 * 毎月1日用: 前月の日報集約テキストから月間ハイライト・思い出ジャーナルを生成
 * @param {string} monthlyDataText 前月日報の集約テキスト
 * @param {string} monthStr YYYY-MM
 * @return {string} Markdown月報
 */
function generateMonthlyJournalMarkdown(monthlyDataText, monthStr) {
  const config = getConfig();
  const url = `${SYSTEM_CONSTANTS.GEMINI_ENDPOINT_BASE}?key=${config.geminiApiKey}`;

  const prompt = `あなたはサウンドディレクター専属の生活秘書です。前月（${monthStr}）の日報記録をもとに、Notionに保存する「月間ハイライト＆思い出ジャーナル」を作成してください。

【前月の日報集約データ】
${monthlyDataText}

【月報作成ルール】
1. 具体的なエピソードの保持:
   - 抽象的なまとめだけでなく、その月にあった印象的な出来事、楽しんだ作品・ゲーム、食事や暮らしの具体的なエピソードが生き生きと思い出せるように記述してください。
2. 思い出の写真の選別と埋め込み（任意）:
   - 日報集約データの中に \`![キャプション](https://...)\` 形式の画像が含まれており、その月のハイライトや思い出として象徴的なものがあれば、該当する話題の直下に **独立した1行** として \`![キャプション](画像URL)\` の形式で適宜埋め込んでください（無理にすべて埋め込む必要はなく、印象的なものを厳選してください）。

【ジャーナル構成要件】
# ${monthStr} 月間ハイライト＆思い出ジャーナル
- ## 🌙 今月の総括・ストーリー（親身で温かい振り返り）
- ## 🏆 大きな成果・完了した主要プロジェクト・タスク
- ## 🎨 クリエイティブ＆インプット（音楽・映画・読書・ゲーム・制作の具体的な記録）
- ## 🌿 心身・健康・生活のリズム（休息や体調管理の傾向）
- ## 🚀 来月への展望・メッセージ
※見出し、箇条書き（\`- \`）、太字（\`**強調**\`）、区切り線（独立行の \`---\`）を活用し、読みやすく温かみのあるMarkdown形式で記述してください。`;

  const requestPayload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      thinkingConfig: {
        thinkingBudget: 0
      }
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(requestPayload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const resJson = JSON.parse(response.getContentText());
  if (resJson.candidates && resJson.candidates[0].content && resJson.candidates[0].content.parts) {
    return resJson.candidates[0].content.parts[0].text;
  }
  return `# ${monthStr} 月間ハイライト\n今月もお疲れ様でした。`;
}

/**
 * 開発・デバッグ用: Gemini APIの接続テスト
 * GASエディタでこの関数を選択して実行すると、APIキーやエンドポイントの疎通確認が可能です。
 */
function testGeminiConnection() {
  const config = getConfig();
  Logger.log('Gemini API Key 確認: ' + (config.geminiApiKey ? config.geminiApiKey.substring(0, 6) + '...' : '未設定'));
  
  try {
    const res = callGeminiFlash('こんにちは！テストです。', [], '【コンテキスト】\nテスト実行中', [], false);
    Logger.log('Gemini API 呼び出し成功！');
    Logger.log('AI返答: ' + JSON.stringify(res, null, 2));
  } catch (e) {
    Logger.log('Gemini API 呼び出し失敗: ' + e.message);
  }
}

