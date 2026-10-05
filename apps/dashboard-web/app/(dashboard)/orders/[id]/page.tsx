import { OrderDetails } from "../../../../features/orders/components/order-details.tsx";

/** `/orders/[id]` — one order (brief I §2.1): its id, `?from=history`. */
export default async function OrderPage({
  params,
  searchParams,
}: PageProps<"/orders/[id]">) {
  const { id } = await params;
  const { from } = await searchParams;
  // Keyed by the id: another order is another page, not this one's state.
  return <OrderDetails key={id} id={id} from={from} />;
}
