import type { NextPage } from 'next';
import Head from 'next/head';

const Home: NextPage = () => {
  return (
    <div className="min-h-screen bg-gray-100">
      <Head>
        <title>Table - Online Poker</title>
        <meta name="description" content="Online poker platform" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="container mx-auto px-4 py-8">
        <h1 className="text-4xl font-bold text-center mb-8">
          Welcome to Table
        </h1>
        <p className="text-center text-gray-600">
          Your online poker platform is getting ready!
        </p>
      </main>
    </div>
  );
};

export default Home;
