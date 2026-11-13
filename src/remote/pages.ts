/** The few pages a person sees: the front page, the sign-in form, and a dead end. No scripts. */

import { SERVER_INFO } from '../server.js';

export type Lang = 'en' | 'vi';

const TEXT = {
  en: {
    signInTitle: 'Sign in to Taiga',
    wants: (app: string, host: string) =>
      `${app} is asking to read your Taiga projects at ${host}. It can only read: nothing in Taiga will be changed.`,
    wantsAny: (app: string) =>
      `${app} is asking to read your Taiga projects. It can only read: nothing in Taiga will be changed.`,
    anApp: 'An app',
    address: 'Taiga address',
    addressHint: 'The address you open Taiga at. For Taiga cloud: tree.taiga.io',
    badAddress: 'No Taiga could be reached at that address. Use the address you open Taiga at.',
    username: 'Username or email',
    password: 'Password',
    submit: 'Sign in and allow',
    passwordNote: 'Your password is sent to Taiga once to sign you in. This server does not store it.',
    returnsTo: (host: string) => `After signing in you are sent back to ${host}.`,
    returnsLocal: 'After signing in you are sent back to an app on this computer.',
    onlyIfYou: 'Continue only if you started this connection yourself, from that app.',
    rejected: 'Taiga did not accept that username and password. Try again.',
    unavailable: 'Taiga could not be reached just now. Try again in a moment.',
    tooMany: 'Too many attempts. Wait a few minutes and try again.',
    expiredTitle: 'This sign-in page has expired',
    expiredBody: 'Go back to the app you came from and connect to Taiga again.',
    homeTitle: 'Taiga for AI assistants',
    pageTitle: 'Taiga for AI assistants: ask Claude about your projects',
    description:
      'Connect Claude or any MCP app to Taiga and ask about projects, sprints, user stories, tasks and issues in plain words. Read-only, with your own Taiga account.',
    readOnly: 'Read-only',
    homeLead: (host: string) =>
      `Ask Claude, or another AI assistant, about your projects, sprints, user stories, tasks, issues and wiki at ${host}, in plain words.`,
    homeLeadAny:
      'Ask Claude, or another AI assistant, about your Taiga projects, sprints, user stories, tasks, issues and wiki in plain words: on Taiga cloud or on your company’s own Taiga.',
    facts: [
      ['Read-only', 'It looks things up. It cannot change anything in Taiga.'],
      ['Your own account', 'You sign in as yourself and see what Taiga lets you see.'],
      ['Nothing stored', 'No database. Your password goes to Taiga once, to sign in.'],
    ],
    connect: 'Connect',
    asks: 'What you can ask',
    examples: [
      'Which stories in the current sprint are not done yet?',
      'What is Linh working on this sprint?',
      'Find the story about exporting invoices as PDF.',
      'Which tasks are left on story 42?',
      'How many tasks did I finish in October?',
      'Where did we write down the release steps?',
    ],
    builtBy: 'Built by',
    signInStepAny: 'Press Connect, enter the address of your Taiga, and sign in with your Taiga account.',
    steps: [
      'Copy this address:',
      'In Claude, open Settings → Connectors → Add custom connector, and paste the address.',
      'Press Connect and sign in with your Taiga account.',
      'Ask in plain words. Claude looks the answer up in Taiga.',
    ],
    otherApps: 'Other AI apps',
    otherAppsLead:
      'Any app that supports remote MCP servers connects with the same address, and asks you to sign in to Taiga the first time. Menus move between versions: if a step looks different, look for “MCP”, “connector” or “tools” in the app’s settings.',
    howTo: {
      claudeCode: 'In a terminal, then type /mcp in Claude Code and choose taiga to sign in:',
      chatgpt:
        'Settings → Apps & Connectors → Advanced settings: turn on Developer mode. Then Create, paste the address, choose OAuth and sign in. Needs a plan with developer mode.',
      vscode:
        'Command palette → “MCP: Add Server” → HTTP, paste the address and name it taiga. Or put this in .vscode/mcp.json. Use it from Copilot Chat in Agent mode.',
      cursor: 'Settings → MCP → Add new MCP server, or put this in ~/.cursor/mcp.json:',
      gemini: 'Put this in ~/.gemini/settings.json, then type /mcp auth taiga to sign in:',
      codex: 'In a terminal:',
      windsurf: 'Put this in ~/.codeium/windsurf/mcp_config.json:',
      otherName: 'Other MCP apps',
      other:
        'Use the address as a remote or “Streamable HTTP” server. Sign-in is OAuth, found by the app itself; there is no key to paste.',
    },
  },
  vi: {
    signInTitle: 'Đăng nhập Taiga',
    wants: (app: string, host: string) =>
      `${app} xin quyền đọc các project Taiga của bạn tại ${host}. Chỉ đọc: không có gì trên Taiga bị thay đổi.`,
    wantsAny: (app: string) =>
      `${app} xin quyền đọc các project Taiga của bạn. Chỉ đọc: không có gì trên Taiga bị thay đổi.`,
    anApp: 'Một ứng dụng',
    address: 'Địa chỉ Taiga',
    addressHint: 'Địa chỉ bạn vẫn mở Taiga. Với Taiga cloud: tree.taiga.io',
    badAddress: 'Không kết nối được Taiga ở địa chỉ này. Hãy dùng địa chỉ bạn vẫn mở Taiga.',
    username: 'Tên đăng nhập hoặc email',
    password: 'Mật khẩu',
    submit: 'Đăng nhập và cho phép',
    passwordNote: 'Mật khẩu được gửi tới Taiga một lần để đăng nhập. Máy chủ này không lưu mật khẩu.',
    returnsTo: (host: string) => `Sau khi đăng nhập, bạn được đưa về ${host}.`,
    returnsLocal: 'Sau khi đăng nhập, bạn được đưa về một ứng dụng trên máy này.',
    onlyIfYou: 'Chỉ tiếp tục nếu chính bạn vừa bắt đầu kết nối này từ ứng dụng đó.',
    rejected: 'Taiga không chấp nhận tên đăng nhập và mật khẩu này. Hãy thử lại.',
    unavailable: 'Hiện chưa kết nối được tới Taiga. Hãy thử lại sau ít phút.',
    tooMany: 'Bạn đã thử quá nhiều lần. Hãy đợi vài phút rồi thử lại.',
    expiredTitle: 'Trang đăng nhập đã hết hạn',
    expiredBody: 'Hãy quay lại ứng dụng bạn đang dùng và kết nối Taiga lại từ đầu.',
    homeTitle: 'Taiga cho trợ lý AI',
    pageTitle: 'Taiga cho trợ lý AI: hỏi Claude về project của bạn',
    description:
      'Kết nối Claude hoặc ứng dụng MCP bất kỳ với Taiga để hỏi về project, sprint, user story, task và issue bằng lời bình thường. Chỉ đọc, dùng chính tài khoản Taiga của bạn.',
    readOnly: 'Chỉ đọc',
    homeLead: (host: string) =>
      `Hỏi Claude, hoặc trợ lý AI khác, về project, sprint, user story, task, issue và wiki của bạn tại ${host}, bằng lời bình thường.`,
    homeLeadAny:
      'Hỏi Claude, hoặc trợ lý AI khác, về project, sprint, user story, task, issue và wiki Taiga của bạn bằng lời bình thường: trên Taiga cloud hoặc Taiga riêng của công ty bạn.',
    facts: [
      ['Chỉ đọc', 'Chỉ tra cứu. Không thay đổi được gì trên Taiga.'],
      ['Tài khoản của bạn', 'Bạn đăng nhập bằng chính mình và chỉ thấy những gì Taiga cho bạn thấy.'],
      ['Không lưu gì', 'Không có cơ sở dữ liệu. Mật khẩu chỉ gửi tới Taiga một lần để đăng nhập.'],
    ],
    connect: 'Kết nối',
    asks: 'Bạn có thể hỏi gì',
    examples: [
      'Sprint hiện tại còn story nào chưa xong?',
      'Sprint này Linh đang làm những gì?',
      'Tìm story về xuất hóa đơn ra PDF.',
      'Story 42 còn những task nào?',
      'Tháng 10 mình đã xong bao nhiêu task?',
      'Các bước release được ghi ở đâu?',
    ],
    builtBy: 'Thực hiện bởi',
    signInStepAny: 'Bấm Connect, nhập địa chỉ Taiga của bạn rồi đăng nhập bằng tài khoản Taiga.',
    steps: [
      'Sao chép địa chỉ này:',
      'Trong Claude, mở Settings → Connectors → Add custom connector rồi dán địa chỉ vào.',
      'Bấm Connect và đăng nhập bằng tài khoản Taiga của bạn.',
      'Hỏi bằng lời bình thường. Claude sẽ tra câu trả lời trên Taiga.',
    ],
    otherApps: 'Ứng dụng AI khác',
    otherAppsLead:
      'Ứng dụng nào hỗ trợ MCP server từ xa cũng kết nối bằng cùng địa chỉ này, và lần đầu sẽ yêu cầu bạn đăng nhập Taiga. Menu có thể thay đổi giữa các phiên bản: nếu không thấy đúng như dưới đây, hãy tìm mục “MCP”, “connector” hoặc “tools” trong cài đặt của ứng dụng.',
    howTo: {
      claudeCode: 'Chạy trong terminal, rồi gõ /mcp trong Claude Code và chọn taiga để đăng nhập:',
      chatgpt:
        'Settings → Apps & Connectors → Advanced settings: bật Developer mode. Sau đó bấm Create, dán địa chỉ, chọn OAuth và đăng nhập. Cần gói có Developer mode.',
      vscode:
        'Command palette → “MCP: Add Server” → HTTP, dán địa chỉ và đặt tên taiga. Hoặc thêm đoạn này vào .vscode/mcp.json. Dùng trong Copilot Chat ở chế độ Agent.',
      cursor: 'Settings → MCP → Add new MCP server, hoặc thêm đoạn này vào ~/.cursor/mcp.json:',
      gemini: 'Thêm đoạn này vào ~/.gemini/settings.json, rồi gõ /mcp auth taiga để đăng nhập:',
      codex: 'Chạy trong terminal:',
      windsurf: 'Thêm đoạn này vào ~/.codeium/windsurf/mcp_config.json:',
      otherName: 'Ứng dụng MCP khác',
      other:
        'Dùng địa chỉ này như một server từ xa hoặc “Streamable HTTP”. Đăng nhập bằng OAuth, ứng dụng tự tìm ra; không có key nào cần dán.',
    },
  },
} as const;

export type LoginError = 'rejected' | 'unavailable' | 'tooMany' | 'badAddress';

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );

/**
 * The colours of the author's site (kietnguyen.io.vn): blue for what can be pressed, cyan for
 * focus and links, a gradient on the heading, on deep navy in the dark and near-white in the light.
 */
const STYLE = `
:root { color-scheme: light dark; --bg: #f8fafc; --card: #ffffff; --inset: #eef3f9; --text: #0b1f3a; --muted: #4b5a70;
  --line: rgb(11 31 58 / 0.14); --field: rgb(11 31 58 / 0.4); --primary: #2563eb; --primary-hover: #1d4ed8;
  --ring: #2563eb; --glow: rgb(37 99 235 / 0.11); --link: #1d4ed8; --grid: rgb(11 31 58 / 0.035);
  --grad: linear-gradient(100deg, #1d4ed8 0%, #0e7490 60%, #2563eb 100%);
  --error-bg: #fdecec; --error: #a12626; }
@media (prefers-color-scheme: dark) { :root { --bg: #0a0f1a; --card: #0f1e36; --inset: #122543; --text: #e6edf5;
  --muted: #a3b1c2; --line: rgb(192 199 209 / 0.16); --field: rgb(192 199 209 / 0.42); --ring: #22d3ee;
  --glow: rgb(37 99 235 / 0.16); --link: #67e8f9; --grid: rgb(148 197 255 / 0.035);
  --grad: linear-gradient(100deg, #60a5fa 0%, #22d3ee 55%, #a5f3fc 100%);
  --error-bg: rgb(248 113 113 / 0.14); --error: #fca5a5; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; padding: 24px 16px; color: var(--text);
  background:
    radial-gradient(48rem 26rem at 50% -8rem, var(--glow), transparent 70%) no-repeat,
    linear-gradient(var(--grid) 1px, transparent 1px) 0 0 / 100% 32px,
    linear-gradient(90deg, var(--grid) 1px, transparent 1px) 0 0 / 32px 100%,
    var(--bg);
  font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { position: relative; max-width: 440px; margin: 6vh auto 0; padding: 28px 24px; background: var(--card);
  border: 1px solid var(--line); border-radius: 16px; box-shadow: 0 24px 60px -32px var(--glow), 0 0 0 1px var(--glow); }
main::before { content: ""; position: absolute; top: -1px; left: 24px; right: 24px; height: 1px;
  background: linear-gradient(90deg, transparent, var(--ring), transparent); opacity: 0.7; }
main.wide { max-width: 600px; }
h1 { margin: 0 0 8px; font-size: 24px; font-weight: 600; line-height: 1.25; letter-spacing: -0.01em;
  color: var(--primary); background: var(--grad); -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; }
.wide h1 { font-size: 30px; }
h2 { margin: 24px 0 10px; font-size: 13px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--muted); }
a { color: var(--link); text-underline-offset: 2px; }
a:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; border-radius: 4px; }
.brand { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 0 0 20px; font-size: 14px; font-weight: 600; }
.brand img { display: block; border-radius: 8px; }
.brand .name { letter-spacing: 0.01em; }
.pill { padding: 2px 9px; font-size: 12px; font-weight: 600; color: var(--link); background: var(--inset);
  border: 1px solid var(--line); border-radius: 999px; }
.lang { margin-left: auto; font-size: 13px; font-weight: 400; color: var(--muted); }
.lang a { margin-left: 8px; }
.lang [aria-current] { color: var(--text); font-weight: 600; text-decoration: none; }
.lead { font-size: 17px; }
.facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 20px 0 0; padding: 0; list-style: none; }
.facts li { margin: 0; padding: 12px; font-size: 13px; line-height: 1.45; color: var(--muted); background: var(--inset);
  border: 1px solid var(--line); border-radius: 12px; }
.facts strong { display: block; margin-bottom: 4px; font-size: 14px; color: var(--text); }
.asks { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin: 0 0 20px; padding: 0; list-style: none; }
.asks li { margin: 0; padding: 9px 12px; font-size: 14px; line-height: 1.4; color: var(--text);
  border: 1px solid var(--line); border-left: 2px solid var(--ring); border-radius: 10px; }
footer { margin-top: 20px; padding-top: 14px; font-size: 13px; color: var(--muted); border-top: 1px solid var(--line); }
@media (max-width: 520px) { .facts, .asks { grid-template-columns: 1fr; } .wide h1 { font-size: 26px; } }
p { margin: 0 0 16px; color: var(--muted); }
label { display: block; margin: 0 0 14px; font-size: 14px; font-weight: 600; }
input { display: block; width: 100%; margin-top: 6px; padding: 10px 12px; font: inherit; color: inherit;
  background: transparent; border: 1px solid var(--field); border-radius: 10px; }
input:focus-visible, button:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
button { width: 100%; margin: 6px 0 16px; padding: 11px 16px; font: inherit; font-weight: 600; cursor: pointer;
  color: #ffffff; background: var(--primary); border: 0; border-radius: 10px; }
button:hover { background: var(--primary-hover); }
.error { padding: 10px 12px; color: var(--error); background: var(--error-bg); border-radius: 10px; }
.note { margin: 0; font-size: 13px; }
.returns { padding: 10px 12px; font-size: 14px; color: var(--text); background: var(--inset);
  border: 1px solid var(--line); border-radius: 10px; }
small { display: block; margin-top: 6px; font-size: 13px; font-weight: 400; color: var(--muted); }
ol { margin: 0 0 16px; padding-left: 22px; }
li { margin-bottom: 10px; }
li::marker { color: var(--ring); font-weight: 600; }
code { display: block; margin-top: 6px; padding: 10px 12px; overflow-wrap: anywhere; user-select: all;
  font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--text); background: var(--inset);
  border: 1px solid var(--line); border-radius: 10px; }
pre { margin: 8px 0 0; padding: 10px 12px; overflow-x: auto; user-select: all; white-space: pre;
  font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--text); background: var(--inset);
  border: 1px solid var(--line); border-radius: 10px; }
.apps { margin: 0 0 16px; }
details { border: 1px solid var(--line); border-radius: 10px; margin-bottom: 8px; }
details[open] { border-color: var(--field); }
summary { padding: 9px 12px; font-size: 14px; font-weight: 600; cursor: pointer; list-style-position: inside; }
summary::marker { color: var(--ring); }
summary:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; border-radius: 10px; }
details > p, details > pre { margin-left: 12px; margin-right: 12px; }
details > p { margin-top: 0; margin-bottom: 0; font-size: 14px; }
details > :last-child { margin-bottom: 12px; }
`;

/** What the front page tells search engines and link previews. The other pages are not for them. */
interface Listed {
  readonly description: string;
  /** The address of this page, and of the same page in each language. */
  readonly url: string;
  readonly alternates: Readonly<Record<Lang | 'default', string>>;
  /** An image for link previews, 1200 by 630. */
  readonly image: string;
  readonly siteName: string;
}

const LOCALE: Record<Lang, string> = { en: 'en_US', vi: 'vi_VN' };

function listedHead(lang: Lang, title: string, listed: Listed): string {
  const other: Lang = lang === 'en' ? 'vi' : 'en';
  return `<meta name="description" content="${escape(listed.description)}">
<link rel="canonical" href="${escape(listed.url)}">
<link rel="alternate" hreflang="en" href="${escape(listed.alternates.en)}">
<link rel="alternate" hreflang="vi" href="${escape(listed.alternates.vi)}">
<link rel="alternate" hreflang="x-default" href="${escape(listed.alternates.default)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escape(listed.siteName)}">
<meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(listed.description)}">
<meta property="og:url" content="${escape(listed.url)}">
<meta property="og:image" content="${escape(listed.image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${escape(listed.siteName)}">
<meta property="og:locale" content="${LOCALE[lang]}">
<meta property="og:locale:alternate" content="${LOCALE[other]}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escape(title)}">
<meta name="twitter:description" content="${escape(listed.description)}">
<meta name="twitter:image" content="${escape(listed.image)}">
`;
}

function page(
  lang: Lang,
  title: string,
  body: string,
  options: { listed?: Listed; wide?: boolean } = {},
): string {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="${options.listed ? 'index, follow' : 'noindex'}">
<title>${escape(title)}</title>
${options.listed ? listedHead(lang, title, options.listed) : ''}<meta name="theme-color" content="#f8fafc" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0a0f1a" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>${STYLE}</style>
</head>
<body>
<main${options.wide ? ' class="wide"' : ''}>
${body}
</main>
</body>
</html>
`;
}

/** The mark and the name, at the top of every page. `extra` goes to the right of them. */
const brand = (extra = '') =>
  `<div class="brand"><img src="/favicon.svg" width="32" height="32" alt=""><span class="name">taiga-mcp</span>${extra}</div>`;

export interface LoginView {
  readonly lang: Lang;
  /**
   * Host name of the one Taiga people sign in to, e.g. "taiga.example.com". Without it, the
   * form asks each person for the address of their Taiga.
   */
  readonly fixedHost: string | undefined;
  /** What stands in the address field: a suggestion at first, then what the person typed. */
  readonly address?: string | undefined;
  /** The app asking for access, by the name it gave itself. */
  readonly app: string | undefined;
  /** Host the person is sent back to after signing in. */
  readonly returnsTo: string;
  /** The sealed authorization request, sent back with the form. */
  readonly request: string;
  readonly error?: LoginError | undefined;
  /** What was typed before, so a wrong password does not empty the form. */
  readonly username?: string | undefined;
}

export function loginPage(view: LoginView): string {
  const t = TEXT[view.lang];
  const app = view.app ?? t.anApp;
  const hostname = view.returnsTo.replace(/:\d+$/, '');
  const returns = ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
    ? t.returnsLocal
    : t.returnsTo(view.returnsTo);
  const asksAddress = view.fixedHost === undefined;
  const address = view.address ?? '';
  // The cursor starts in the first field that still needs typing.
  const focusAddress = asksAddress && address === '';
  const addressField = `<label>${escape(t.address)}
<input name="address" inputmode="url" autocomplete="url" autocapitalize="none" spellcheck="false" required placeholder="https://taiga.example.com"${focusAddress ? ' autofocus' : ''} value="${escape(address)}">
<small>${escape(t.addressHint)}</small>
</label>
`;
  return page(
    view.lang,
    t.signInTitle,
    `${brand()}
<h1>${escape(t.signInTitle)}</h1>
<p>${escape(view.fixedHost === undefined ? t.wantsAny(app) : t.wants(app, view.fixedHost))}</p>
<p class="returns">${escape(returns)} ${escape(t.onlyIfYou)}</p>
${view.error ? `<p class="error" role="alert">${escape(t[view.error])}</p>` : ''}
<form method="post" action="/login">
<input type="hidden" name="request" value="${escape(view.request)}">
${asksAddress ? addressField : ''}<label>${escape(t.username)}
<input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required${focusAddress ? '' : ' autofocus'} value="${escape(view.username ?? '')}">
</label>
<label>${escape(t.password)}
<input name="password" type="password" autocomplete="current-password" required>
</label>
<button type="submit">${escape(t.submit)}</button>
</form>
<p class="note">${escape(t.passwordNote)}</p>`,
  );
}

export function expiredPage(lang: Lang): string {
  const t = TEXT[lang];
  return page(
    lang,
    t.expiredTitle,
    `${brand()}\n<h1>${escape(t.expiredTitle)}</h1>\n<p>${escape(t.expiredBody)}</p>`,
  );
}

/**
 * How to add the server in AI apps other than Claude, each as a closed section: what to do,
 * and the command or configuration to copy, with this server's address already in it.
 */
function otherApps(how: (typeof TEXT)[Lang]['howTo'], mcpUrl: string): string[] {
  const json = (value: unknown) => JSON.stringify(value, null, 2);
  const apps: readonly (readonly [name: string, what: string, copy?: string])[] = [
    ['Claude Code', how.claudeCode, `claude mcp add --transport http taiga ${mcpUrl}`],
    ['ChatGPT', how.chatgpt],
    ['VS Code (GitHub Copilot)', how.vscode, json({ servers: { taiga: { type: 'http', url: mcpUrl } } })],
    ['Cursor', how.cursor, json({ mcpServers: { taiga: { url: mcpUrl } } })],
    ['Gemini CLI', how.gemini, json({ mcpServers: { taiga: { httpUrl: mcpUrl } } })],
    ['Codex CLI', how.codex, `codex mcp add taiga --url ${mcpUrl}\ncodex mcp login taiga`],
    ['Windsurf', how.windsurf, json({ mcpServers: { taiga: { serverUrl: mcpUrl } } })],
    [how.otherName, how.other],
  ];
  return apps.map(
    ([name, what, copy]) =>
      `<details><summary>${escape(name)}</summary><p>${escape(what)}</p>${copy === undefined ? '' : `<pre>${escape(copy)}</pre>`}</details>`,
  );
}

/** Who made this, for the foot of the front page. */
const AUTHOR = { name: 'Kiet Nguyen', url: 'https://kietnguyen.io.vn' } as const;

/**
 * The front page: what this is, how to connect, and what to ask. It is the one page meant to be
 * found, so it carries a description and a preview image. `fixedHost` as in the sign-in page;
 * `publicUrl` is the address of this server, `chosen` the language picked with `?lang=`, if any.
 */
export function homePage(
  lang: Lang,
  fixedHost: string | undefined,
  publicUrl: URL,
  chosen?: Lang | undefined,
): string {
  const t = TEXT[lang];
  const at = (path: string) => new URL(path, publicUrl).href;
  const [copy, add, signIn, ask] = t.steps;
  const steps = [add, fixedHost === undefined ? t.signInStepAny : signIn, ask];
  const language = (code: Lang, label: string) =>
    `<a href="/?lang=${code}" hreflang="${code}" lang="${code}"${code === lang ? ' aria-current="true"' : ''}>${label}</a>`;
  return page(
    lang,
    t.pageTitle,
    `${brand(`<span class="pill">${escape(t.readOnly)}</span><nav class="lang" aria-label="Language">${language('en', 'English')}${language('vi', 'Tiếng Việt')}</nav>`)}
<h1>${escape(t.homeTitle)}</h1>
<p class="lead">${escape(fixedHost === undefined ? t.homeLeadAny : t.homeLead(fixedHost))}</p>
<ul class="facts">
${t.facts.map(([name, what]) => `<li><strong>${escape(name)}</strong>${escape(what)}</li>`).join('\n')}
</ul>
<h2>${escape(t.connect)}</h2>
<ol>
<li>${escape(copy)}<code>${escape(at('/mcp'))}</code></li>
${steps.map((step) => `<li>${escape(step)}</li>`).join('\n')}
</ol>
<h2>${escape(t.asks)}</h2>
<ul class="asks">
${t.examples.map((example) => `<li>${escape(example)}</li>`).join('\n')}
</ul>
<h2>${escape(t.otherApps)}</h2>
<p class="note">${escape(t.otherAppsLead)}</p>
<div class="apps">
${otherApps(t.howTo, at('/mcp')).join('\n')}
</div>
<footer>taiga-mcp ${escape(SERVER_INFO.version)} · ${escape(t.builtBy)} <a href="${AUTHOR.url}" rel="author">${AUTHOR.name}</a></footer>`,
    {
      wide: true,
      listed: {
        description: t.description,
        url: at(chosen === undefined ? '/' : `/?lang=${chosen}`),
        alternates: { en: at('/?lang=en'), vi: at('/?lang=vi'), default: at('/') },
        image: at('/og.png'),
        siteName: t.homeTitle,
      },
    },
  );
}
