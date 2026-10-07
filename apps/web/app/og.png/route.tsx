import { ImageResponse } from 'next/og';
import { product } from '@bullebrowser/brand-tokens';
import { SHARE_IMAGE } from '@/lib/metadata';

export const dynamic = 'force-static';

// The card shown when a link to the site is shared: the name, the tagline and
// the four things the product helps with, in the site's charcoal and teal.
// It is a route with a .png name rather than the opengraph-image convention so
// that the exported file has an extension the host can serve as an image.
const CHARCOAL = '#142127';
const TEAL = '#20BAD1';

const HELPS_WITH = [
  'Discover opportunities',
  'Understand funder priorities',
  'Assess alignment',
  'Develop proposals ethically',
];

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          background: `linear-gradient(135deg, ${CHARCOAL} 0%, #1B2D35 100%)`,
          padding: '80px',
          color: '#FFFFFF',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '44px' }}>
          <div
            style={{
              width: '88px',
              height: '88px',
              borderRadius: '20px',
              background: TEAL,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '54px',
              fontWeight: 800,
              color: CHARCOAL,
            }}
          >
            B
          </div>
          <div style={{ fontSize: '64px', fontWeight: 800, letterSpacing: -2 }}>{product.name}</div>
        </div>
        <div style={{ fontSize: '52px', fontWeight: 700, lineHeight: 1.12, maxWidth: 1000 }}>{product.tagline}</div>
        <div
          style={{
            marginTop: '36px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            maxWidth: 1040,
          }}
        >
          {HELPS_WITH.map((item) => (
            <div
              key={item}
              style={{
                display: 'flex',
                padding: '10px 20px',
                borderRadius: '999px',
                border: '2px solid rgba(255, 255, 255, 0.25)',
                fontSize: '24px',
                color: 'rgba(255, 255, 255, 0.9)',
              }}
            >
              {item}
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: '44px',
            fontSize: '24px',
            color: TEAL,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: TEAL }} />
          By {product.vendor}
        </div>
      </div>
    ),
    { width: SHARE_IMAGE.width, height: SHARE_IMAGE.height },
  );
}
