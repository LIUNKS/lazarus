import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';

export const alt = 'Lazarus: resurrect dead JavaScript into strict, verified TypeScript.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Passing `fonts` drops ImageResponse's built-in sans, so reload the Geist that ships with next for the tagline.
export default async function OpengraphImage() {
  const bg = await readFile(join(process.cwd(), 'public/images/og-base.jpg'));
  const geist = await readFile(join(process.cwd(), 'node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf'));
  const fraktur =await readFile(join(process.cwd(), 'assets/fonts/unifrakturcook/UnifrakturCook-Bold.ttf'));
  const src = `data:image/jpeg;base64,${bg.toString('base64')}`;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative', background: '#09090b', fontFamily: 'Geist' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" width={1200} height={630} style={{ position: 'absolute', inset: 0 }} />
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            paddingTop: 36,
          }}
        >
          <div style={{ display: 'flex', fontFamily: 'UnifrakturCook', fontSize: 84, fontWeight: 700, color: '#ece4d4', letterSpacing: 4 }}>
            Lazarus
          </div>
          <div style={{ display: 'flex', marginTop: 8, fontFamily: 'Geist', fontSize: 28, color: '#f2832b' }}>
            Resurrect dead JavaScript into strict, verified TypeScript.
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: [
        { name: 'Geist', data: geist, weight: 400, style: 'normal' },
        { name: 'UnifrakturCook', data: fraktur, weight: 700, style: 'normal' },
      ],
    },
  );
}
