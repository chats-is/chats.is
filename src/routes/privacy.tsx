import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';

export const Route = createFileRoute('/privacy')({
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Privacy Policy') }] }),
  component: PrivacyPage
});

function PrivacyPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">Privacy Policy</h1>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">1. Information We Collect</h2>
        <p>When you use our AI Chatbot, we collect:</p>
        <ul className="list-disc pl-6">
          <li>
            Authentication information when you sign in via GitHub or Google
          </li>
          <li>
            Basic profile information from your authentication provider (such as
            name and email)
          </li>
          <li>Chat conversations and interactions with our AI models</li>
          <li>Technical information necessary for the service to function</li>
        </ul>

        <h2 className="mt-6 text-xl font-semibold">
          2. How We Use Your Information
        </h2>
        <p>We use your information to:</p>
        <ul className="list-disc pl-6">
          <li>Provide and improve our AI chat services</li>
          <li>Maintain and optimize the chat history feature</li>
          <li>Ensure the security and proper functioning of our service</li>
        </ul>

        <h2 className="mt-6 text-xl font-semibold">3. Data Storage</h2>
        <p>
          Your data is stored securely in our Postgres database (either Vercel
          Postgres or Neon Postgres). We implement appropriate security measures
          to protect your information.
        </p>

        <h2 className="mt-6 text-xl font-semibold">4. AI Models</h2>
        <p>
          We integrate with various AI models including OpenAI, Google Gemini,
          Claude AI, and Grok. Each interaction with these models is subject to
          their respective privacy policies and terms of service.
        </p>

        <h2 className="mt-6 text-xl font-semibold">5. Data Sharing</h2>
        <p>
          We do not sell your personal information. Your chat data is only
          shared with the AI model providers as necessary to provide the
          service.
        </p>

        <h2 className="mt-6 text-xl font-semibold">6. Your Rights</h2>
        <p>You have the right to:</p>
        <ul className="list-disc pl-6">
          <li>Access your personal information</li>
          <li>Request deletion of your data</li>
          <li>Export your chat history</li>
        </ul>

        <h2 className="mt-6 text-xl font-semibold">7. Contact</h2>
        <p>
          For any privacy-related questions or concerns, please open an issue on
          our GitHub repository.
        </p>
      </section>
    </div>
  );
}
