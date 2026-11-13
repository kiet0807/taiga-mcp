/** The few pages a person sees: the front page, the sign-in form, and a dead end. No scripts. */

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
    homeLead: (host: string) =>
      `Ask Claude, or another AI assistant, about your projects, sprints, user stories and issues at ${host}. Read-only: it cannot change anything in Taiga.`,
    homeLeadAny:
      'Ask Claude, or another AI assistant, about your Taiga projects, sprints, user stories and issues: on Taiga cloud or on your company’s own Taiga. Read-only: it cannot change anything in Taiga.',
    signInStepAny: 'Press Connect, enter the address of your Taiga, and sign in with your Taiga account.',
    steps: [
      'Copy this address:',
      'In Claude, open Settings → Connectors → Add custom connector, and paste the address.',
      'Press Connect and sign in with your Taiga account.',
      'Ask in plain words, for example: “Which stories in the current sprint are not done yet?”',
    ],
    otherApps: 'Other apps that support MCP connect the same way, with the same address.',
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
    homeLead: (host: string) =>
      `Hỏi Claude, hoặc trợ lý AI khác, về project, sprint, user story và issue của bạn tại ${host}. Chỉ đọc: không thay đổi được gì trên Taiga.`,
    homeLeadAny:
      'Hỏi Claude, hoặc trợ lý AI khác, về project, sprint, user story và issue Taiga của bạn: trên Taiga cloud hoặc Taiga riêng của công ty bạn. Chỉ đọc: không thay đổi được gì trên Taiga.',
    signInStepAny: 'Bấm Connect, nhập địa chỉ Taiga của bạn rồi đăng nhập bằng tài khoản Taiga.',
    steps: [
      'Sao chép địa chỉ này:',
      'Trong Claude, mở Settings → Connectors → Add custom connector rồi dán địa chỉ vào.',
      'Bấm Connect và đăng nhập bằng tài khoản Taiga của bạn.',
      'Hỏi bằng lời bình thường, ví dụ: “Sprint hiện tại còn story nào chưa xong?”',
    ],
    otherApps: 'Các ứng dụng khác có hỗ trợ MCP cũng kết nối như vậy, với cùng địa chỉ.',
  },
} as const;

export type LoginError = 'rejected' | 'unavailable' | 'tooMany' | 'badAddress';

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );

const STYLE = `
:root { color-scheme: light dark; --bg: #f4f5f7; --card: #fff; --text: #1c2330; --muted: #5b6577;
  --line: #d9dde5; --accent: #2f6f4f; --accent-text: #fff; --error-bg: #fdecec; --error: #a12626; }
@media (prefers-color-scheme: dark) { :root { --bg: #12151b; --card: #1b2029; --text: #e8ebf1;
  --muted: #9aa4b5; --line: #2f3643; --accent: #4fa57a; --accent-text: #0d1512; --error-bg: #3a1d1f; --error: #f0a3a3; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--text);
  font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 440px; margin: 6vh auto 0; padding: 28px 24px; background: var(--card);
  border: 1px solid var(--line); border-radius: 12px; }
h1 { margin: 0 0 8px; font-size: 22px; line-height: 1.25; }
p { margin: 0 0 16px; color: var(--muted); }
label { display: block; margin: 0 0 14px; font-size: 14px; font-weight: 600; }
input { display: block; width: 100%; margin-top: 6px; padding: 10px 12px; font: inherit; color: inherit;
  background: transparent; border: 1px solid var(--line); border-radius: 8px; }
input:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button { width: 100%; margin: 6px 0 16px; padding: 11px 16px; font: inherit; font-weight: 600; cursor: pointer;
  color: var(--accent-text); background: var(--accent); border: 0; border-radius: 8px; }
.error { padding: 10px 12px; color: var(--error); background: var(--error-bg); border-radius: 8px; }
.note { margin: 0; font-size: 13px; }
.returns { padding: 10px 12px; font-size: 14px; color: var(--text); border: 1px solid var(--line); border-radius: 8px; }
small { display: block; margin-top: 6px; font-size: 13px; font-weight: 400; color: var(--muted); }
ol { margin: 0 0 16px; padding-left: 22px; }
li { margin-bottom: 10px; }
code { display: block; margin-top: 6px; padding: 10px 12px; overflow-wrap: anywhere; user-select: all;
  font: 14px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--text);
  border: 1px solid var(--line); border-radius: 8px; }
`;

function page(lang: Lang, title: string, body: string): string {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escape(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

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
    `<h1>${escape(t.signInTitle)}</h1>
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
  return page(lang, t.expiredTitle, `<h1>${escape(t.expiredTitle)}</h1>\n<p>${escape(t.expiredBody)}</p>`);
}

/** The front page: what this is and how to connect. `fixedHost` as in the sign-in page. */
export function homePage(lang: Lang, fixedHost: string | undefined, mcpUrl: string): string {
  const t = TEXT[lang];
  const [copy, add, signIn, ask] = t.steps;
  const steps = [add, fixedHost === undefined ? t.signInStepAny : signIn, ask];
  return page(
    lang,
    t.homeTitle,
    `<h1>${escape(t.homeTitle)}</h1>
<p>${escape(fixedHost === undefined ? t.homeLeadAny : t.homeLead(fixedHost))}</p>
<ol>
<li>${escape(copy)}<code>${escape(mcpUrl)}</code></li>
${steps.map((step) => `<li>${escape(step)}</li>`).join('\n')}
</ol>
<p class="note">${escape(t.otherApps)}</p>`,
  );
}
