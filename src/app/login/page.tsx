import { SignInForm } from "./sign-in-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-blue-700 text-sm font-bold text-white">
            R
          </span>
          <span className="text-xl font-bold tracking-tight text-slate-950">
            RouteBook
          </span>
        </div>
        <h1 className="mt-8 text-2xl font-bold tracking-tight text-slate-950">
          Sign in to your account
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Use the account provided by your RouteBook administrator.
        </p>
        <SignInForm />
      </section>
    </main>
  );
}
