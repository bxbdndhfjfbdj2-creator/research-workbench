"use client";

import { FormEvent, useState } from "react";
import { authClient } from "../../src/auth-client";

export default function LoginPage() {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");

    const result = await authClient.signIn.email({
      email,
      password,
      callbackURL: "/portfolio",
    });

    if (result.error) {
      setMessage("登录失败，请检查账户和密码。");
      setPending(false);
      return;
    }

    window.location.assign("/portfolio");
  }

  return (
    <main>
      <h1>Research Workbench</h1>
      <p>内部研究团队登录</p>
      <form onSubmit={submit}>
        <label>
          邮箱
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          密码
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? "登录中…" : "登录"}
        </button>
      </form>
      {message ? <p role="alert">{message}</p> : null}
    </main>
  );
}
