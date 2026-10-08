import { LoginForm } from "../../features/auth/components/login-form.tsx";

/** `/login` (brief I §2.1), with `?next=` back to where the guard came from. */
export default function LoginPage() {
  return <LoginForm />;
}
