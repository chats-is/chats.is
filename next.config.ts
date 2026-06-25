import type { NextConfig } from 'next';

import '@/lib/env';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
        port: '',
        pathname: '**'
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        port: '',
        pathname: '**'
      },
      {
        protocol: 'https',
        hostname: '*.public.blob.vercel-storage.com',
        port: '',
        pathname: '**'
      }
    ]
  },
  async redirects() {
    // Legacy standalone media pages were folded into the unified chat view.
    return [
      ...['image', 'video', 'audio'].flatMap(kind => [
        { source: `/${kind}`, destination: '/', permanent: false },
        {
          source: `/${kind}/:id`,
          destination: '/chat/:id',
          permanent: false
        }
      ])
    ];
  },
  async headers() {
    // The artifact preview iframe executes untrusted, model-generated React in
    // a sandboxed iframe (allow-scripts, no allow-same-origin) — i.e. an opaque
    // origin. In an opaque origin the CSP keyword 'self' matches nothing, so a
    // 'self'-based script-src/style-src would block the frame's own Next.js
    // runtime chunks and break every preview. We therefore restrict only with
    // absolute directives (no origin matching): block network egress so the
    // sandboxed code can't exfiltrate, and limit images to data/blob. Script
    // isolation is already provided by the sandbox.
    //
    // connect-src: locked down everywhere. In dev the frame page needs the Next
    // HMR websocket ('self' can't express it from an opaque origin, and
    // connect-src 'none' would block it and reload-loop the frame), so dev
    // allows only websocket schemes — fetch/XHR exfiltration stays blocked even
    // when a dev server is exposed on a LAN or tunnel.
    const isProd = process.env.NODE_ENV === 'production';
    const csp = [
      isProd ? "connect-src 'none'" : 'connect-src ws: wss:',
      'img-src data: blob:',
      "form-action 'none'"
    ].join('; ');

    return [
      {
        source: '/artifact-preview-frame',
        headers: [{ key: 'Content-Security-Policy', value: csp }]
      }
    ];
  }
};

export default nextConfig;
