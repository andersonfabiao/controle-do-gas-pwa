import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata={title:"Controle do Gás",description:"Acompanhe compras, consumo e duração do seu botijão.",manifest:"/controle-do-gas-pwa/manifest.json",icons:{icon:"/controle-do-gas-pwa/icons/icon-192.png",apple:"/controle-do-gas-pwa/icons/apple-touch-icon.png"}};
export const viewport: Viewport={width:"device-width",initialScale:1,viewportFit:"cover",themeColor:"#1d9e75"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body>{children}</body></html>}
