/**
 * The header's tabs and which one is the page's (brief ي-ب §5): «الطلبات»
 * and «السجل» on their own path alone — an order's page is neither, as
 * before — and «المنيو» on /menu and on its «المُزالة», /menu/removed.
 */
export function isCurrentTab(pathname: string, href: string): boolean {
  if (href === "/menu")
    return pathname === "/menu" || pathname.startsWith("/menu/");
  return pathname === href;
}
