import type { Metadata } from "next";

export const metadata: Metadata = { title: "Acceso" };

export default function Layout({ children }: LayoutProps<"/acceso">) {
  return children;
}
