// Help page content (English + Japanese). Both languages must have the same
// section ids (anchors used by in-app <Tip> links): start, key, lobby, table,
// hand, actions, rankings, host, chips, faq. Screenshots: public/help-img/<lang>/<file>
// (same file names in both languages).
//
// Button and label names are quoted exactly as the UI shows them
// (src/i18n/*.ts); rules and numbers come from convex/lib/constants.ts.
import type { Lang } from "./core";

export type HelpShot = { file: string; caption: string };

export type HelpBlock =
  | { kind: "p"; text: string }
  | { kind: "steps"; items: string[] }
  | { kind: "list"; items: string[] }
  | { kind: "terms"; items: [string, string][] }
  | { kind: "note"; text: string }
  | { kind: "shot"; file: string; caption: string }
  /** two or more screenshots side by side (they wrap on narrow screens) */
  | { kind: "shots"; items: HelpShot[] };

export type HelpSectionId = "start" | "key" | "lobby" | "table" | "hand" | "actions" | "rankings" | "host" | "chips" | "faq";

export type HelpSection = { id: HelpSectionId; icon: string; title: string; blocks: HelpBlock[] };

export type HelpContent = { title: string; intro: string; tocLabel: string; sections: HelpSection[] };

const en: HelpContent = {
  title: "How to play",
  intro: "Everything you need to get from a new account to your first showdown: the site, the table, and the rules of no-limit Texas Hold'em. Chips are play money — have fun.",
  tocLabel: "Contents",
  sections: [
    {
      id: "start",
      icon: "🚀",
      title: "Getting started",
      blocks: [
        { kind: "p", text: "nporkerd is live no-limit Texas Hold'em that you play with friends in the browser — 2 to 9 players per table. There's nothing to install and no email or password: your account is a private key that you keep." },
        { kind: "shot", file: "landing.png", caption: "The front page. “Create a free account” starts sign-up; “I have a key” logs you in." },
        { kind: "steps", items: [
          "Press “Create a free account”.",
          "Choose a username (3–20 characters: letters, digits and _). Other players see it at the table, and it can't be changed later.",
          "Press “Create account”. A private key is generated right in your browser.",
          "Save the key (see the next section), tick the box, and press “Continue to the lobby”.",
        ] },
        { kind: "shot", file: "register-name.png", caption: "Step 1 of 3: pick a username. The green ticks show the name is valid." },
        { kind: "p", text: "Every new account starts with 10,000 play-money chips." },
        { kind: "p", text: "The top bar is always there: the 🌐 EN / 日本語 language switch, “? Help” (this page, in a new tab), the sound button with its volume slider, your bankroll (chips you own), your name and “Log out”." },
        { kind: "shot", file: "topbar.png", caption: "The top bar: language, Help, sound, bankroll, account." },
      ],
    },
    {
      id: "key",
      icon: "🔑",
      title: "Your private key (= your password)",
      blocks: [
        { kind: "p", text: "Instead of a password, your account uses a cryptographic key made in your browser. The key never leaves your browser; the server only stores the matching public half. The flip side: nobody — not even the site's owner — can recover a lost key." },
        { kind: "shot", file: "register-key.png", caption: "Step 2 of 3: save your key. It is shown only once. (The key is blurred in this picture.)" },
        { kind: "list", items: [
          "Press “⬇ Download key file” to save nporkerd-key-<name>.txt, or “Copy key” to put the npk_… key in your password manager. Keep it private: anyone with the key can log in as you.",
          "The fingerprint (a short code) lets you check later that you're using the right key.",
          "There is no password reset. If you lose the key, the account and its chips are gone for good — just create a new account (it gets 10,000 chips too).",
        ] },
        { kind: "p", text: "To log in, press “Log in” in the top bar, then drop your key file on the box (or click it to choose the file). That fills in your username as well. You can also paste the npk_… key into the “Private key” box and type your username. Then press “Log in”." },
        { kind: "shot", file: "login.png", caption: "Logging in: drop the key file, or paste the key." },
        { kind: "note", text: "Your login is kept only in this browser tab. It stays valid for up to 30 days, but closing the tab logs you out. After that (or after “Log out”), just log in again with the same key file." },
      ],
    },
    {
      id: "lobby",
      icon: "🏛️",
      title: "The lobby",
      blocks: [
        { kind: "p", text: "After logging in you land in the lobby. The gold “What to do now” banner always tells you the next step. Below it is the list of open public tables, updated live." },
        { kind: "shot", file: "lobby.png", caption: "The lobby: the “What to do now” banner and the table list." },
        { kind: "terms", items: [
          ["Blinds", "The two forced bets each hand, small / big (e.g. 10/20). Bigger blinds = bigger pots."],
          ["Buy-in", "The chips you bring from your bankroll when you sit down at that table."],
          ["Clock", "Seconds each player has to act (or “off”)."],
          ["Seats", "How many seats are taken — the dots, and e.g. “1/4 seats”."],
          ["Live / Waiting", "Live: a hand is being played. Waiting: the game hasn't started yet."],
          ["Join → / Watch →", "Click a table to open it. You watch first, then take a seat. It says “Watch →” when the table is full or you can't afford the buy-in."],
        ] },
        { kind: "p", text: "To host your own table, use the “Host a table” form. The defaults are fine for a first game — just press “Open table”." },
        { kind: "shot", file: "create-table.png", caption: "The “Host a table” form, with its beginner-friendly defaults." },
        { kind: "terms", items: [
          ["Table name", "Shown in the lobby. Anything you like."],
          ["Stakes", "Presets that set the blinds and buy-in together: Micro 5/10 (buy-in 500), Low 10/20 (1,000), Mid 25/50 (2,500), High 100/200 (10,000)."],
          ["Small blind / Big blind / Buy-in", "Or set them yourself. The buy-in must be at least 10 big blinds; about 50 is typical."],
          ["Seats", "The most players at once, 2–9 (6 by default)."],
          ["Turn clock", "Time to act: 15–120 seconds, or Off (30 seconds by default)."],
          ["Visibility", "🌐 Public: listed in the lobby for anyone. 🔒 Private: hidden from the lobby; people need the link and a passphrase (4+ characters) to join."],
        ] },
        { kind: "p", text: "Invite links: every table has its own link (…/room/…). Send it to friends. Someone who opens it without an account is asked to sign up or log in, then comes straight back to the table. You can also paste a link into “Got an invite?” in the lobby and press “Open”. Private tables ask for the passphrase first." },
      ],
    },
    {
      id: "table",
      icon: "🪑",
      title: "At the table",
      blocks: [
        { kind: "p", text: "Opening a table makes you a spectator. You can watch and chat right away. Your own seat is always drawn at the bottom of the table, so the view turns around you." },
        { kind: "shot", file: "room-spectator.png", caption: "Watching a table: every glowing “Sit here” chair is free." },
        { kind: "steps", items: [
          "Click a glowing empty seat (“Sit here”). The buy-in moves from your bankroll to your stack on the table.",
          "Wait for the host to press Deal (or press it yourself if you're the host). If a hand is already running, you're dealt in from the next one.",
          "Play! The banner under the table always says what to do now.",
        ] },
        { kind: "shots", items: [
          { file: "room-invite.png", caption: "Alone at the table: copy the invite link and send it to a friend." },
          { file: "wait-host.png", caption: "Seated and waiting for the host to start the game." },
        ] },
        { kind: "terms", items: [
          ["D", "The dealer button. It moves one seat to the left every hand."],
          ["SB / BB", "Small blind and big blind: the two players who post the forced bets this hand."],
          ["Name plate", "Player name and stack (chips they have left on the table). A gold glow and “Your turn” / “Acting” mark whose turn it is; the bar under it is the turn timer."],
          ["Chips in front of a seat", "What that player has bet in the current betting round."],
          ["Pot", "All chips bet in this hand, in the middle. Side pots are labelled “Main”, “Side 1”, …"],
          ["Tags", "“All-in”, “Folded”, “Sitting out”, “Winner”, and the last action (“Check”, “Call 20”, …)."],
        ] },
        { kind: "p", text: "The right-hand panel has the table chat (everyone in the room, players and spectators, can read and write), the table settings, the player list (a green dot = online), and the host controls for the host." },
        { kind: "shots", items: [
          { file: "chat.png", caption: "Table chat." },
          { file: "host-controls.png", caption: "Table info and players (host controls at the bottom, for the host only)." },
        ] },
        { kind: "p", text: "Under the banner you'll find your seat controls:" },
        { kind: "shot", file: "seat-controls.png", caption: "Your stack, your bankroll, and the seat buttons." },
        { kind: "terms", items: [
          ["☕ Sit out", "Keep your seat and stack but skip the coming hands. Press “▶ I'm back” to be dealt in again from the next hand."],
          ["＋ Top up to …", "Refill your stack up to the buy-in from your bankroll. Only between hands (or while you're not in the current hand)."],
          ["Stand up", "Leave the seat but keep watching. Your stack goes back to your bankroll."],
          ["🔗 Invite", "(top right) Copies the table's link to send to friends."],
          ["Leave", "(top right) Leave the table and go back to the lobby. Your stack goes back to your bankroll."],
        ] },
        { kind: "shot", file: "sitting-out.png", caption: "Sitting out: press “▶ I'm back” to play again." },
        { kind: "note", text: "Standing up or leaving during a hand you're playing folds that hand — you'll be asked to confirm." },
      ],
    },
    {
      id: "hand",
      icon: "♠️",
      title: "How a hand works",
      blocks: [
        { kind: "p", text: "Texas Hold'em in one sentence: make the best 5-card hand from your 2 private cards plus 5 shared cards — or make everyone else give up." },
        { kind: "steps", items: [
          "Blinds: the two players after the dealer button post the small and big blind (forced bets), so there is always something to win.",
          "Everyone still in the game gets 2 hole cards, face down. Only you can see yours.",
          "Pre-flop: a betting round, starting with the player after the big blind.",
          "Flop: 3 shared cards are dealt face up in the middle, then another betting round.",
          "Turn: a 4th shared card, then a betting round.",
          "River: the 5th and last shared card, then the last betting round.",
          "Showdown: the players still in turn their cards face up. The best 5-card hand, using any mix of your 2 cards and the 5 on the board, wins the pot. Equal hands split it.",
        ] },
        { kind: "shot", file: "board-turn.png", caption: "On the turn: 4 shared cards, the pot, and your two cards at the bottom with “Your hand: …”." },
        { kind: "list", items: [
          "If everyone else folds, the last player left wins the pot right away — no cards need to be shown.",
          "From the flop on, the betting starts with the first player still in to the left of the dealer button.",
          "“Your hand: …” under your seat always shows the best hand you have right now.",
          "If players are all-in for different amounts, the extra chips go to a side pot that only the players who put chips into it can win.",
          "If everyone left is all-in, the remaining cards are dealt out with no more betting.",
        ] },
        { kind: "shot", file: "hand-result.png", caption: "The result: who won, how much, and with what. The next hand starts by itself 5 seconds later." },
      ],
    },
    {
      id: "actions",
      icon: "🎯",
      title: "Your turn: the actions",
      blocks: [
        { kind: "p", text: "When it's your turn, your seat glows, the banner says “Your turn — …” with your options, and the action buttons appear. You only ever see the moves that are allowed right now." },
        { kind: "shot", file: "your-turn.png", caption: "Your turn on the flop: nobody has bet yet, so you can check or bet." },
        { kind: "terms", items: [
          ["Fold", "Give up this hand. You lose only what you've already put in."],
          ["Check", "Pass without betting. Only possible when nobody has bet in this round."],
          ["Call", "Match the current bet (the button shows how much more you need to put in). “Call all-in” if that takes all your chips."],
          ["Bet", "Be the first to put chips in this round. The smallest bet is the big blind."],
          ["Raise to", "Increase the bet. The amount is your total for this round. A raise must be at least as big as the previous bet or raise."],
          ["All-in", "Bet your whole stack. You can't be forced out of the hand after that — you can only win the part of the pot you matched."],
        ] },
        { kind: "shot", file: "action-bar.png", caption: "Facing a bet: Fold, Call, Raise to, All-in, with the raise slider and size presets." },
        { kind: "p", text: "Choosing a bet or raise size: drag the slider, type an amount in the box (Enter sends it), or tap a preset — Min (the smallest allowed), ½ Pot, ¾ Pot, Pot, or Max (all-in). Then press Bet / Raise to." },
        { kind: "terms", items: [
          ["F", "Fold"],
          ["C", "Check or call"],
          ["R", "Bet or raise (the amount currently selected)"],
          ["Shift+A", "All-in"],
        ] },
        { kind: "p", text: "Turn clock: if the table has one, the bar under your name plate and the banner show the seconds left. When time runs out you check automatically if you can, otherwise you fold. If every one of your turns in a hand ran out of time, you're sat out after that hand — press “▶ I'm back” to keep playing." },
      ],
    },
    {
      id: "rankings",
      icon: "🏆",
      title: "Hand rankings",
      blocks: [
        { kind: "p", text: "From best to worst. Only your best 5 cards count; if two hands are the same type, the higher cards win (then the remaining “kickers”). Suits never break ties." },
        { kind: "terms", items: [
          ["Royal Flush", "A K Q J 10 of the same suit — A♠ K♠ Q♠ J♠ 10♠"],
          ["Straight Flush", "Five cards in a row, same suit — 9♥ 8♥ 7♥ 6♥ 5♥"],
          ["Four of a Kind", "Four cards of the same rank — Q♣ Q♦ Q♥ Q♠ 7♦"],
          ["Full House", "Three of a kind plus a pair — K♠ K♥ K♦ 4♣ 4♠"],
          ["Flush", "Any five cards of the same suit — A♦ J♦ 9♦ 6♦ 2♦"],
          ["Straight", "Five cards in a row, mixed suits — 10♣ 9♦ 8♠ 7♥ 6♣ (A 2 3 4 5 counts too)"],
          ["Three of a Kind", "Three cards of the same rank — 8♠ 8♥ 8♣ K♦ 3♠"],
          ["Two Pair", "Two different pairs — J♥ J♣ 5♠ 5♦ A♣"],
          ["Pair", "Two cards of the same rank — 10♠ 10♥ A♦ 7♣ 4♠"],
          ["High Card", "None of the above; the highest card plays — A♣ Q♦ 9♠ 6♥ 3♣"],
        ] },
      ],
    },
    {
      id: "host",
      icon: "🎩",
      title: "Hosting a table",
      blocks: [
        { kind: "p", text: "Whoever opens a table is its host. The host starts the game; after the first hand, the next hand is dealt automatically 5 seconds after each one ends." },
        { kind: "shot", file: "host-deal.png", caption: "The host's view once enough players are seated: press “▶ Deal”." },
        { kind: "terms", items: [
          ["▶ Deal", "Starts the game. Needs at least 2 seated players with chips (who aren't sitting out). Everyone seated with chips is dealt in. The host can deal even while sitting out or out of chips."],
          ["⏹ End game", "Stops the game after the current hand finishes (“Ending after this hand”). Players keep their seats; press Deal to start again."],
          ["Close table", "Closes the table for everyone and gives every seated player their stack back. Only between hands — end the game first."],
        ] },
        { kind: "list", items: [
          "If the host leaves, the table gets a new host automatically: the seated player who has been at the table longest (or, if nobody is seated, the longest-staying spectator). When the last person leaves, the table closes.",
          "Auto-resume: if a hand can't start because fewer than 2 players have chips (someone stood up or sat out), the table waits and starts again by itself a few seconds after enough players are back — unless the host pressed End game.",
          "Tables left waiting with no activity for 6 hours are closed automatically.",
        ] },
      ],
    },
    {
      id: "chips",
      icon: "🪙",
      title: "Chips, buy-ins and free chips",
      blocks: [
        { kind: "terms", items: [
          ["Bankroll", "The chips you own, shown in the top bar. New accounts start with 10,000."],
          ["Stack", "The chips you have in front of you at a table. Only your stack can be bet."],
          ["Buy-in", "When you sit down, the table's buy-in moves from your bankroll into your stack."],
          ["Top up", "“＋ Top up to …” refills your stack to the buy-in from your bankroll, between hands."],
          ["Stand up / Leave", "Your whole stack goes back into your bankroll. Closing a table also returns every seated player's stack."],
        ] },
        { kind: "p", text: "Free chips: while your bankroll is under 1,000, the lobby shows “🎁 Claim 1,000 free chips”. You can claim 1,000 chips once every 24 hours." },
        { kind: "note", text: "All chips are play money. They can't be bought, sold or cashed out, and have no real-world value." },
      ],
    },
    {
      id: "faq",
      icon: "❓",
      title: "FAQ",
      blocks: [
        { kind: "terms", items: [
          ["Nothing is happening — what do I do?", "Read the “What to do now” banner under the table (or at the top of the lobby). It always says what the game is waiting for: you, another player, or the host pressing Deal."],
          ["Why can't I sit down?", "The table may be full, or your bankroll may be smaller than the buy-in (claim free chips in the lobby, or pick a table with a smaller buy-in). If you're already seated, you can't take a second seat."],
          ["How do I play with friends?", "Open a table, press “🔗 Invite” (or “🔗 Copy invite link”), and send the link. For a private table, send the passphrase too. When at least 2 players are seated, the host presses Deal."],
          ["Can I play on my phone?", "Yes. The site works in mobile browsers; the table and buttons resize to fit. Keyboard shortcuts are for computers."],
          ["How do I switch language?", "Use the 🌐 EN / 日本語 switch in the top bar. The choice is remembered in this browser."],
          ["How do I turn the sound off?", "Click the speaker icon (🔊) in the top bar to mute. While sound is on, the slider next to it sets the volume."],
          ["I closed the tab during a hand.", "Your seat stays. The turn clock acts for you (check or fold), and you may be sat out. Come back to the table link and press “▶ I'm back”. Seated players who stay offline for a while between games are stood up and their stack goes back to their bankroll."],
          ["I lost my key.", "It can't be recovered. Create a new account — it starts with 10,000 chips."],
        ] },
      ],
    },
  ],
};

const ja: HelpContent = {
  title: "遊び方",
  intro: "アカウント作成から最初のショーダウンまで、サイトの使い方・テーブルの見かた・ノーリミット テキサスホールデムのルールをまとめました。チップはすべてプレイマネーです。気軽に楽しんでください。",
  tocLabel: "目次",
  sections: [
    {
      id: "start",
      icon: "🚀",
      title: "はじめに",
      blocks: [
        { kind: "p", text: "nporkerd は、ブラウザで友だちとリアルタイムに遊べるノーリミット テキサスホールデムです（1 テーブル 2〜9 人）。インストールもメールアドレスもパスワードも不要で、アカウントはあなたが保管する秘密鍵だけです。" },
        { kind: "shot", file: "landing.png", caption: "トップページ。「無料でアカウントを作成」で登録、「鍵を持っています」でログインします。" },
        { kind: "steps", items: [
          "「無料でアカウントを作成」を押します。",
          "ユーザー名を決めます（半角英数字と _ で 3〜20 文字）。テーブルでほかのプレイヤーに表示され、あとから変更できません。",
          "「アカウントを作成」を押すと、ブラウザの中で秘密鍵が作られます。",
          "鍵を保存し（次の章を参照）、チェックを入れて「ロビーへ進む」を押します。",
        ] },
        { kind: "shot", file: "register-name.png", caption: "ステップ 1/3：ユーザー名を決めます。緑のチェックは使える名前という意味です。" },
        { kind: "p", text: "新しいアカウントには、最初に 10,000 チップ（プレイマネー）が配られます。" },
        { kind: "p", text: "画面上部のバーはいつでも表示されています。🌐 EN / 日本語 の言語切り替え、「? ヘルプ」（このページを新しいタブで開きます）、サウンドボタンと音量スライダー、所持チップ、あなたの名前、「ログアウト」が並びます。" },
        { kind: "shot", file: "topbar.png", caption: "上部バー：言語・ヘルプ・サウンド・所持チップ・アカウント。" },
      ],
    },
    {
      id: "key",
      icon: "🔑",
      title: "秘密鍵（＝パスワード）",
      blocks: [
        { kind: "p", text: "パスワードの代わりに、ブラウザの中で作られる暗号鍵を使います。鍵はブラウザの外に出ず、サーバーには対になる公開鍵だけが保存されます。そのため、鍵をなくすと誰も（運営者も）復元できません。" },
        { kind: "shot", file: "register-key.png", caption: "ステップ 2/3：鍵を保存します。表示されるのは今回だけです（画像では鍵をぼかしています）。" },
        { kind: "list", items: [
          "「⬇ 鍵ファイルをダウンロード」で nporkerd-key-<名前>.txt を保存するか、「鍵をコピー」で npk_… の鍵をパスワードマネージャーに保存します。鍵を持っている人は誰でもあなたとしてログインできるので、人に見せないでください。",
          "フィンガープリント（短いコード）で、あとから正しい鍵かどうかを確認できます。",
          "パスワードの再設定はできません。鍵をなくすとアカウントとチップは永久に使えなくなります。その場合は新しいアカウントを作ってください（新規アカウントにも 10,000 チップが配られます）。",
        ] },
        { kind: "p", text: "ログインするには、上部バーの「ログイン」を押し、鍵ファイルを枠にドロップします（枠をクリックしてファイルを選んでも構いません）。ユーザー名も自動で入ります。npk_… の鍵を「秘密鍵」欄に貼り付けて、ユーザー名を入力しても構いません。最後に「ログイン」を押します。" },
        { kind: "shot", file: "login.png", caption: "ログイン：鍵ファイルをドロップするか、鍵を貼り付けます。" },
        { kind: "note", text: "ログイン状態はこのブラウザのタブの中だけに保存されます。最長 30 日間有効ですが、タブを閉じるとログアウトします。そのあと（または「ログアウト」したあと）は、同じ鍵ファイルでもう一度ログインしてください。" },
      ],
    },
    {
      id: "lobby",
      icon: "🏛️",
      title: "ロビー",
      blocks: [
        { kind: "p", text: "ログインするとロビーに移ります。金色の「いまやること」の案内が、次にやることをいつも教えてくれます。その下に、開いている公開テーブルの一覧がリアルタイムで表示されます。" },
        { kind: "shot", file: "lobby.png", caption: "ロビー：「いまやること」の案内とテーブル一覧。" },
        { kind: "terms", items: [
          ["ブラインド", "毎ハンドの 2 つの強制ベット（スモール／ビッグ、例：10/20）。大きいほどポットも大きくなります。"],
          ["バイイン", "そのテーブルに着席するときに、所持チップから持ち込むチップです。"],
          ["持ち時間", "1 回の行動に使える秒数（「なし」もあります）。"],
          ["席", "埋まっている席の数です（● の数と「1/4 席」などの表示）。"],
          ["プレイ中／待機中", "プレイ中：ハンドが進行中。待機中：まだゲームが始まっていません。"],
          ["参加する → ／ 観戦する →", "テーブルをクリックすると開きます。最初は観戦から始まり、そこから着席します。満席のときや、バイインに所持チップが足りないときは「観戦する →」と表示されます。"],
        ] },
        { kind: "p", text: "自分のテーブルを作るには「テーブルを作る」フォームを使います。はじめてなら初期値のままで大丈夫です。「テーブルを開く」を押すだけです。" },
        { kind: "shot", file: "create-table.png", caption: "「テーブルを作る」フォーム。初期値は初心者向けです。" },
        { kind: "terms", items: [
          ["テーブル名", "ロビーに表示される名前です。自由に付けてください。"],
          ["レート", "ブラインドとバイインをまとめて設定するプリセットです。マイクロ 5/10（バイイン 500）、ロー 10/20（1,000）、ミドル 25/50（2,500）、ハイ 100/200（10,000）。"],
          ["スモールブラインド／ビッグブラインド／バイイン", "自分で入力することもできます。バイインはビッグブラインドの 10 倍以上が必要で、50 倍くらいが標準的です。"],
          ["席数", "同時に座れる最大人数です。2〜9（初期値 6）。"],
          ["持ち時間", "1 回の行動に使える時間です。15〜120 秒、または「なし」（初期値 30 秒）。"],
          ["公開設定", "🌐 公開：ロビーに表示され、誰でも参加できます。🔒 非公開：ロビーには表示されず、リンクと合言葉（4 文字以上）を知っている人だけが参加できます。"],
        ] },
        { kind: "p", text: "招待リンク：テーブルごとに専用のリンク（…/room/…）があります。友だちに送りましょう。アカウントのない人がリンクを開くと、登録またはログインのあと、そのままテーブルに戻ってきます。ロビーの「招待されましたか？」にリンクを貼り付けて「開く」を押しても入れます。非公開テーブルでは、先に合言葉を聞かれます。" },
      ],
    },
    {
      id: "table",
      icon: "🪑",
      title: "テーブル画面",
      blocks: [
        { kind: "p", text: "テーブルを開くと、まず観戦者として入ります。すぐに観戦とチャットができます。自分の席は常にテーブルの一番下に表示され、あなたを中心にテーブルが回って見えます。" },
        { kind: "shot", file: "room-spectator.png", caption: "観戦中のテーブル。光っている「ここに座る」の席はすべて空席です。" },
        { kind: "steps", items: [
          "光っている空席（「ここに座る」）をクリックします。バイイン分のチップが所持チップからテーブル上のスタックに移ります。",
          "ホストが「ディール」を押すのを待ちます（自分がホストなら自分で押します）。すでにハンドが進行中なら、次のハンドから配られます。",
          "プレイしましょう！ テーブルの下の案内が、いまやることをいつも表示しています。",
        ] },
        { kind: "shots", items: [
          { file: "room-invite.png", caption: "1 人だけのとき：招待リンクをコピーして友だちに送りましょう。" },
          { file: "wait-host.png", caption: "着席して、ホストがゲームを始めるのを待っているところ。" },
        ] },
        { kind: "terms", items: [
          ["D", "ディーラーボタン。毎ハンド 1 つずつ左へ移ります。"],
          ["SB／BB", "スモールブラインドとビッグブラインド。このハンドで強制ベットを払う 2 人です。"],
          ["ネームプレート", "プレイヤー名とスタック（テーブルに残っているチップ）。金色に光って「あなたの番」「考え中」と出ている人が行動中で、下のバーが残りの持ち時間です。"],
          ["席の前のチップ", "そのプレイヤーがいまのベットラウンドで賭けた額です。"],
          ["ポット", "このハンドで賭けられたチップの合計で、中央に表示されます。サイドポットがあるときは「メイン」「サイド1」…と分かれます。"],
          ["タグ", "「オールイン」「フォールド」「離席中」「勝者」と、直前のアクション（「チェック」「コール 20」など）。"],
        ] },
        { kind: "p", text: "右側のパネルには、テーブルチャット（プレイヤーも観戦者も、テーブルにいる全員が読み書きできます）、テーブルの設定、プレイヤー一覧（緑の点＝オンライン）、そしてホストにはホスト操作が表示されます。" },
        { kind: "shots", items: [
          { file: "chat.png", caption: "テーブルチャット。" },
          { file: "host-controls.png", caption: "テーブル情報とプレイヤー一覧（下のホスト操作はホストだけに表示）。" },
        ] },
        { kind: "p", text: "案内の下には、自分の席の操作があります。" },
        { kind: "shot", file: "seat-controls.png", caption: "スタック、所持チップ、席の操作ボタン。" },
        { kind: "terms", items: [
          ["☕ 離席", "席とスタックはそのままで、次のハンドから休みます。「▶ 復帰する」を押すと、次のハンドからまた配られます。"],
          ["＋ … までチップ補充", "所持チップから、スタックをバイインの額まで補充します。ハンドとハンドの間（またはいまのハンドに参加していないとき）だけ使えます。"],
          ["席を立つ", "席を離れて観戦に戻ります。スタックは所持チップに戻ります。"],
          ["🔗 招待", "（右上）テーブルのリンクをコピーします。友だちに送りましょう。"],
          ["退出", "（右上）テーブルを離れてロビーに戻ります。スタックは所持チップに戻ります。"],
        ] },
        { kind: "shot", file: "sitting-out.png", caption: "離席中：「▶ 復帰する」を押すとまた参加できます。" },
        { kind: "note", text: "参加中のハンドの途中で席を立つ・退出すると、そのハンドはフォールドになります（確認が表示されます）。" },
      ],
    },
    {
      id: "hand",
      icon: "♠️",
      title: "1 ハンドの流れ",
      blocks: [
        { kind: "p", text: "テキサスホールデムをひとことで言うと、自分だけの手札 2 枚と全員共通の 5 枚を組み合わせて最も強い 5 枚の役を作るか、ほかの全員を降ろすゲームです。" },
        { kind: "steps", items: [
          "ブラインド：ディーラーボタンの次の 2 人が、スモールブラインドとビッグブラインド（強制ベット）を出します。これで毎回ポットに賭け金が入ります。",
          "参加者全員に、伏せた手札（ホールカード）が 2 枚ずつ配られます。自分の手札は自分にしか見えません。",
          "プリフロップ：ビッグブラインドの次のプレイヤーから、最初のベットラウンドを行います。",
          "フロップ：中央に共通カードが 3 枚表向きで開かれ、ベットラウンドを行います。",
          "ターン：4 枚目の共通カードが開かれ、ベットラウンドを行います。",
          "リバー：5 枚目（最後）の共通カードが開かれ、最後のベットラウンドを行います。",
          "ショーダウン：残ったプレイヤーが手札を表にします。手札 2 枚とボード 5 枚から自由に選んだ最も強い 5 枚の役の人がポットを獲得します。同じ強さなら山分けです。",
        ] },
        { kind: "shot", file: "board-turn.png", caption: "ターン：共通カード 4 枚とポット。下が自分の手札で、「あなたの役：…」が表示されています。" },
        { kind: "list", items: [
          "ほかの全員がフォールドしたら、残った 1 人がその場でポットを獲得します。手札を見せる必要はありません。",
          "フロップ以降のベットは、ディーラーボタンの左隣でまだ残っているプレイヤーから始まります。",
          "自分の席の下の「あなたの役：…」には、いまの時点で一番強い役が表示されます。",
          "オールインした額がプレイヤーごとに違うときは、超えた分がサイドポットになり、そのサイドポットにチップを入れたプレイヤーだけが獲得できます。",
          "残った全員がオールインのときは、それ以上ベットせずに残りのカードが配られます。",
        ] },
        { kind: "shot", file: "hand-result.png", caption: "結果：誰が、いくら、どの役で勝ったか。5 秒後に次のハンドが自動で始まります。" },
      ],
    },
    {
      id: "actions",
      icon: "🎯",
      title: "自分の番：アクション",
      blocks: [
        { kind: "p", text: "自分の番になると、席が光り、案内に「あなたの番です：…」と選べるアクションが表示され、アクションボタンが現れます。表示されるのは、そのとき選べるアクションだけです。" },
        { kind: "shot", file: "your-turn.png", caption: "フロップで自分の番。まだ誰もベットしていないので、チェックかベットができます。" },
        { kind: "terms", items: [
          ["フォールド", "このハンドを降ります。失うのはすでに賭けた分だけです。"],
          ["チェック", "賭けずに次の人へ回します。このラウンドでまだ誰もベットしていないときだけ選べます。"],
          ["コール", "いまのベット額に合わせます（ボタンに追加で出す額が表示されます）。それで全チップになる場合は「オールインでコール」です。"],
          ["ベット", "このラウンドで最初にチップを賭けます。最小ベットはビッグブラインドの額です。"],
          ["レイズ", "賭け金を上げます。金額はこのラウンドでの合計額です。前のベット（またはレイズ）で上がった幅以上に上げる必要があります。"],
          ["オールイン", "スタックを全部賭けます。そのあとは降ろされることはありませんが、獲得できるのは自分が合わせた分のポットまでです。"],
        ] },
        { kind: "shot", file: "action-bar.png", caption: "ベットされたとき：フォールド・コール・レイズ・オールインと、レイズ額のスライダー・プリセット。" },
        { kind: "p", text: "ベット額・レイズ額の決め方：スライダーを動かすか、入力欄に金額を入れる（Enter でそのまま送信）か、プリセットを押します。プリセットは 最小（賭けられる最小額）・½ポット・¾ポット・ポット・最大（オールイン）です。最後に「ベット」／「レイズ」を押します。" },
        { kind: "terms", items: [
          ["F", "フォールド"],
          ["C", "チェック／コール"],
          ["R", "ベット／レイズ（いま選んでいる額で）"],
          ["Shift+A", "オールイン"],
        ] },
        { kind: "p", text: "持ち時間：テーブルに持ち時間があるときは、ネームプレートの下のバーと案内に残り秒数が表示されます。時間切れになると、チェックできるときは自動でチェック、できないときは自動でフォールドします。1 つのハンドで自分の番がすべて時間切れだった場合は、そのハンドのあと離席状態になります。続けるには「▶ 復帰する」を押してください。" },
      ],
    },
    {
      id: "rankings",
      icon: "🏆",
      title: "役の強さ",
      blocks: [
        { kind: "p", text: "強い順に並べています。使うのは一番強くなる 5 枚だけです。同じ役どうしなら、数字の大きいカードが強く、それでも同じなら残りのカード（キッカー）で比べます。スートで強さは決まりません。" },
        { kind: "terms", items: [
          ["ロイヤルフラッシュ", "同じスートの A K Q J 10 — A♠ K♠ Q♠ J♠ 10♠"],
          ["ストレートフラッシュ", "同じスートで数字が 5 枚連続 — 9♥ 8♥ 7♥ 6♥ 5♥"],
          ["フォーカード", "同じ数字が 4 枚 — Q♣ Q♦ Q♥ Q♠ 7♦"],
          ["フルハウス", "スリーカード＋ワンペア — K♠ K♥ K♦ 4♣ 4♠"],
          ["フラッシュ", "同じスートが 5 枚 — A♦ J♦ 9♦ 6♦ 2♦"],
          ["ストレート", "スートに関係なく数字が 5 枚連続 — 10♣ 9♦ 8♠ 7♥ 6♣（A 2 3 4 5 も可）"],
          ["スリーカード", "同じ数字が 3 枚 — 8♠ 8♥ 8♣ K♦ 3♠"],
          ["ツーペア", "ペアが 2 組 — J♥ J♣ 5♠ 5♦ A♣"],
          ["ワンペア", "同じ数字が 2 枚 — 10♠ 10♥ A♦ 7♣ 4♠"],
          ["ハイカード", "どの役もないとき。一番大きいカードで比べます — A♣ Q♦ 9♠ 6♥ 3♣"],
        ] },
      ],
    },
    {
      id: "host",
      icon: "🎩",
      title: "ホストになったら",
      blocks: [
        { kind: "p", text: "テーブルを作った人がホストです。ホストがゲームを始めると、2 ハンド目以降は前のハンドが終わってから 5 秒後に自動で配られます。" },
        { kind: "shot", file: "host-deal.png", caption: "プレイヤーがそろったときのホストの画面：「▶ ディール」を押します。" },
        { kind: "terms", items: [
          ["▶ ディール", "ゲームを始めます。チップを持って着席している（離席中でない）プレイヤーが 2 人以上必要で、その全員に配られます。ホスト自身が離席中やチップ切れでも、ほかのプレイヤーのために配れます。"],
          ["⏹ ゲーム終了", "いまのハンドが終わったところでゲームを止めます（「このハンドで終了します」）。プレイヤーは着席したままで、もう一度「ディール」を押せば再開できます。"],
          ["テーブルを閉じる", "全員に対してテーブルを閉じ、着席中のプレイヤーにスタックを返却します。ハンドとハンドの間だけ使えるので、先にゲームを終了してください。"],
        ] },
        { kind: "list", items: [
          "ホストが退出すると、自動で新しいホストが決まります。着席しているプレイヤーのうち一番長くテーブルにいる人（着席者がいなければ、一番長くいる観戦者）です。最後の 1 人が退出するとテーブルは閉じられます。",
          "自動再開：チップを持つプレイヤーが 2 人未満になって（席を立った・離席したなど）次のハンドを始められないときは、テーブルは待機し、人数がそろうと数秒後に自動で再開します。ただし、ホストが「ゲーム終了」を押した場合は再開しません。",
          "待機中のまま 6 時間動きのないテーブルは、自動で閉じられます。",
        ] },
      ],
    },
    {
      id: "chips",
      icon: "🪙",
      title: "チップ・バイイン・無料チップ",
      blocks: [
        { kind: "terms", items: [
          ["所持チップ", "あなたが持っているチップで、上部バーに表示されます。新しいアカウントは 10,000 から始まります。"],
          ["スタック", "テーブルで自分の前にあるチップです。賭けられるのはスタックだけです。"],
          ["バイイン", "着席すると、テーブルのバイイン額が所持チップからスタックに移ります。"],
          ["チップ補充", "「＋ … までチップ補充」で、ハンドの合間にスタックをバイインの額まで所持チップから補充できます。"],
          ["席を立つ／退出", "スタックは全額所持チップに戻ります。テーブルが閉じられたときも、着席中の全員のスタックが戻ります。"],
        ] },
        { kind: "p", text: "無料チップ：所持チップが 1,000 未満のあいだは、ロビーに「🎁 無料チップ 1,000 を受け取る」が表示されます。24 時間に 1 回、1,000 チップを受け取れます。" },
        { kind: "note", text: "チップはすべてプレイマネーです。購入・売却・換金はできず、現実の価値はありません。" },
      ],
    },
    {
      id: "faq",
      icon: "❓",
      title: "よくある質問",
      blocks: [
        { kind: "terms", items: [
          ["何も起きません。どうすればいいですか？", "テーブルの下（ロビーでは上部）の「いまやること」の案内を見てください。あなたの操作・ほかのプレイヤー・ホストの「ディール」のどれを待っているのかが、いつも表示されています。"],
          ["席に座れません。", "満席か、所持チップがバイインより少ない可能性があります（ロビーで無料チップを受け取るか、バイインの少ないテーブルを選んでください）。すでに着席している場合、2 つ目の席には座れません。"],
          ["友だちと遊ぶには？", "テーブルを作って「🔗 招待」（または「🔗 招待リンクをコピー」）を押し、リンクを送ります。非公開テーブルなら合言葉も伝えてください。2 人以上が着席したら、ホストが「ディール」を押します。"],
          ["スマートフォンで遊べますか？", "はい。スマートフォンのブラウザでも使えます。テーブルやボタンは画面に合わせて表示されます。キー操作はパソコン向けです。"],
          ["言語を切り替えるには？", "上部バーの 🌐 EN / 日本語 で切り替えます。選んだ言語はこのブラウザに記憶されます。"],
          ["音を消すには？", "上部バーのスピーカーアイコン（🔊）を押すとミュートになります。サウンドがオンのときは、横のスライダーで音量を調整できます。"],
          ["ハンドの途中でタブを閉じてしまいました。", "席はそのまま残ります。持ち時間があるテーブルでは自動でチェックまたはフォールドになり、離席状態になることがあります。テーブルのリンクから戻って「▶ 復帰する」を押してください。ゲームの合間にしばらくオフラインのままの着席者は席を立った扱いになり、スタックは所持チップに戻ります。"],
          ["鍵をなくしました。", "復元はできません。新しいアカウントを作ってください。10,000 チップから始められます。"],
        ] },
      ],
    },
  ],
};

export const HELP: Record<Lang, HelpContent> = { en, ja };
