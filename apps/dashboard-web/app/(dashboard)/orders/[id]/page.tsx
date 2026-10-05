import { OrderDetails } from "../../../../features/orders/components/order-details.tsx";

/** `/orders/[id]` — one order (brief I §2.1): its id, `?from=history`. */
export default async function OrderPage({
  params,
  searchParams,
}: PageProps<"/orders/[id]">) {
  const { id } = await params;
  const { from } = await searchParams;
  return <OrderDetails id={id} from={from} />;
}
