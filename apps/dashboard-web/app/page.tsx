import { RootRedirect } from "../features/auth/components/root-redirect.tsx";

/** `/` (brief I §2.1): to the orders with a session, to login without. */
export default function RootPage() {
  return <RootRedirect />;
}
