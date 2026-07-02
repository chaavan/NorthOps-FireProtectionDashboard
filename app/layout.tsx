import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import './globals.css'
import 'mapbox-gl/dist/mapbox-gl.css'
import SessionProvider from '@/components/SessionProvider'
import SurveyPopupHost from '@/components/survey/SurveyPopupHost'
import { SurveyProvider } from '@/lib/survey/SurveyContext'
import { ThemeProvider } from '@/lib/ThemeContext'
import { softwareConfig } from '@/lib/softwareConfig'

export const metadata: Metadata = {
  title: `${softwareConfig.name} Dashboard`,
  description: `${softwareConfig.tagline} for ${softwareConfig.name}`,
  icons: {
    icon: softwareConfig.logoUrl,
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var d=document.documentElement;if(t==='light'){d.classList.remove('dark')}else{d.classList.add('dark')}}catch(e){}})();`,
          }}
        />
        <ThemeProvider>
          <SessionProvider>
            <SurveyProvider>
              {children}
              <SurveyPopupHost />
            </SurveyProvider>
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}

