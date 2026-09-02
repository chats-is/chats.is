import { Link } from '@tanstack/react-router';

export function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-background py-2">
      <h1 className="text-6xl font-bold text-gray-900 dark:text-white">404</h1>
      <h3 className="mt-4 text-3xl text-gray-800 dark:text-gray-200">
        Not Found
      </h3>
      <p className="mt-1 text-gray-600 dark:text-gray-400">
        Sorry, the page you are looking for does not exist.
      </p>
      <Link
        to="/"
        className="mt-6 text-blue-500 hover:underline dark:text-blue-400"
      >
        Return Home
      </Link>
    </div>
  );
}
