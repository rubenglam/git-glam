import { NextResponse } from 'next/server'

const latestReleaseMetadata = 'https://github.com/rubenglam/project-git-branch/releases/latest/download/latest.json'

export async function GET() {
  try {
    const response = await fetch(latestReleaseMetadata, { cache: 'no-store' })
    if (!response.ok) throw new Error(`Release metadata returned ${response.status}`)

    const release = await response.json() as {
      platforms?: { 'windows-x86_64'?: { url?: string } }
    }
    const installerUrl = release.platforms?.['windows-x86_64']?.url
    const parsedUrl = installerUrl ? new URL(installerUrl) : null

    if (!parsedUrl || parsedUrl.hostname !== 'github.com' || !parsedUrl.pathname.includes('/releases/download/') || !parsedUrl.pathname.toLowerCase().endsWith('.exe')) {
      throw new Error('The latest release does not include a valid Windows installer')
    }

    return NextResponse.redirect(parsedUrl, 302)
  } catch (error) {
    console.error('Could not locate the latest Git Glam installer:', error)
    return NextResponse.redirect('https://github.com/rubenglam/project-git-branch/releases/latest', 302)
  }
}
