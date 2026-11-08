// No Restomate chrome here: the storefront is fully tenant-branded (CSS variables set in the page).
export default function StorefrontLayout({ children }: LayoutProps<"/">) {
  return <>{children}</>;
}
