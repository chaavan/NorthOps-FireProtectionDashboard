import type { Metadata, Viewport } from 'next'
import './globals.css'
import 'mapbox-gl/dist/mapbox-gl.css'
import SessionProvider from '@/components/SessionProvider'
import SurveyPopupHost from '@/components/survey/SurveyPopupHost'
import { SurveyProvider } from '@/lib/survey/SurveyContext'
import { ThemeProvider } from '@/lib/ThemeContext'
import { PermissionsProvider } from '@/lib/PermissionsContext'
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
    <html lang="en" className="dark" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ThemeProvider>
          <SessionProvider>
            <PermissionsProvider>
              <SurveyProvider>
                {children}
                <SurveyPopupHost />
              </SurveyProvider>
            </PermissionsProvider>
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}

