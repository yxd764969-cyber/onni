/** @type {import('next').NextConfig} */
const nextConfig = {
  // 防止手机浏览器缓存旧的 HTML（JS 文件本身带 hash，不会缓存问题）
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
