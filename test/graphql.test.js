import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { createStore } from '../src/data/store.js';
import { createApolloServer } from '../src/server.js';
import { createFinanceService } from '../src/services/financeService.js';

const server = createApolloServer();
let store;
let finance;

/** Executes an operation against the schema with a fresh in-memory store. */
async function execute(query, variables) {
  const response = await server.executeOperation(
    { query, variables },
    { contextValue: { store, finance } }
  );

  return response.body.singleResult;
}

describe('GraphQL API', () => {
  before(async () => {
    await server.start();
  });

  after(async () => {
    await server.stop();
  });

  beforeEach(() => {
    store = createStore();
    finance = createFinanceService();
  });

  it('returns all users with their posts', async () => {
    const result = await execute('{ users { id name email posts { id title } } }');

    assert.equal(result.errors, undefined);
    assert.equal(result.data.users.length, 2);
    assert.equal(result.data.users[0].name, 'Ada Lovelace');
    assert.equal(result.data.users[0].posts.length, 1);
    assert.equal(result.data.users[0].posts[0].title, 'Hello GraphQL');
  });

  it('returns a single user by id and null for an unknown id', async () => {
    const found = await execute('query ($id: ID!) { user(id: $id) { name } }', { id: '2' });
    assert.equal(found.data.user.name, 'Alan Turing');

    const missing = await execute('query ($id: ID!) { user(id: $id) { name } }', { id: '404' });
    assert.equal(missing.data.user, null);
  });

  it('returns posts with their author', async () => {
    const all = await execute('{ posts { id title author { name } } }');
    assert.equal(all.data.posts.length, 2);
    assert.equal(all.data.posts[0].author.name, 'Ada Lovelace');

    const single = await execute('query ($id: ID!) { post(id: $id) { title } }', { id: '2' });
    assert.equal(single.data.post.title, 'On computable numbers');
  });

  it('creates a user', async () => {
    const result = await execute(
      'mutation ($name: String!, $email: String!) { createUser(name: $name, email: $email) { id name email } }',
      { name: 'Grace Hopper', email: 'grace@example.com' }
    );

    assert.equal(result.errors, undefined);
    assert.equal(result.data.createUser.name, 'Grace Hopper');
    assert.equal(store.listUsers().length, 3);
  });

  it('creates a post for an existing author', async () => {
    const result = await execute(
      'mutation ($title: String!, $content: String!, $authorId: ID!) { createPost(title: $title, content: $content, authorId: $authorId) { id title author { id } } }',
      { title: 'New post', content: 'Body', authorId: '1' }
    );

    assert.equal(result.errors, undefined);
    assert.equal(result.data.createPost.title, 'New post');
    assert.equal(result.data.createPost.author.id, '1');
  });

  it('rejects a post with an unknown author', async () => {
    const result = await execute(
      'mutation ($title: String!, $content: String!, $authorId: ID!) { createPost(title: $title, content: $content, authorId: $authorId) { id } }',
      { title: 'Orphan', content: 'Body', authorId: '404' }
    );

    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].extensions.code, 'BAD_USER_INPUT');
    assert.equal(store.listPosts().length, 2);
  });

  it('returns a cross-source portfolio overview with positions and P/L', async () => {
    const result = await execute(`{
      portfolioOverview {
        accounts { id name provider currency }
        positions { symbol quantity marketValue unrealizedPnL }
        performance { totalValue dayPnL totalPnL }
        totalMarketValue
        totalUnrealizedPnL
        errors { source code category status retryable message }
      }
    }`);

    assert.equal(result.errors, undefined);
    assert.equal(result.data.portfolioOverview.accounts[0].provider, 'OpenTrading');
    assert.equal(result.data.portfolioOverview.positions.length, 2);
    assert.equal(result.data.portfolioOverview.totalMarketValue, 2145);
    assert.equal(result.data.portfolioOverview.totalUnrealizedPnL, 285);
    assert.deepEqual(result.data.portfolioOverview.errors, []);
  });

  it('maps trade history to tax-relevant events', async () => {
    const result = await execute(`{
      tradeHistory(symbol: "AAPL") {
        trades { id side symbol fills { id quantity price } }
        orders { id status symbol }
        taxEvents { tradeId symbol proceeds costBasis realizedGain }
        errors { source code }
      }
    }`);

    assert.equal(result.errors, undefined);
    assert.equal(result.data.tradeHistory.trades.length, 2);
    assert.equal(result.data.tradeHistory.taxEvents.length, 1);
    assert.equal(result.data.tradeHistory.taxEvents[0].tradeId, 'trade-2');
    assert.equal(result.data.tradeHistory.taxEvents[0].realizedGain, 129.6);
    assert.deepEqual(result.data.tradeHistory.errors, []);
  });

  it('returns a tax estimate that is traceable to underlying trades', async () => {
    const result = await execute(`query ($year: Int!) {
      taxEstimate(taxYear: $year) {
        taxYear
        totalProceeds
        totalCostBasis
        realizedGain
        estimatedTax
        events { id tradeId occurredAt realizedGain }
        errors { source code }
      }
    }`, { year: 2026 });

    assert.equal(result.errors, undefined);
    assert.equal(result.data.taxEstimate.taxYear, 2026);
    assert.equal(result.data.taxEstimate.totalProceeds, 720);
    assert.equal(result.data.taxEstimate.totalCostBasis, 590.4);
    assert.equal(result.data.taxEstimate.estimatedTax, 28.51);
    assert.equal(result.data.taxEstimate.events[0].tradeId, 'trade-2');
    assert.deepEqual(result.data.taxEstimate.errors, []);
  });

  it('filters trade history by side and date range', async () => {
    const result = await execute(`{
      tradeHistory(side: "SELL", from: "2026-02-01T00:00:00.000Z") {
        trades { id side executedAt }
        orders { id }
        taxEvents { tradeId }
        pageInfo { totalCount limit offset hasNextPage hasPreviousPage }
      }
    }`);

    assert.equal(result.errors, undefined);
    assert.deepEqual(result.data.tradeHistory.trades.map((trade) => trade.id), ['trade-2']);
    assert.deepEqual(result.data.tradeHistory.taxEvents.map((event) => event.tradeId), ['trade-2']);
    assert.equal(result.data.tradeHistory.pageInfo.totalCount, 1);
    assert.equal(result.data.tradeHistory.pageInfo.hasNextPage, false);
  });

  it('paginates trade history and reports page metadata', async () => {
    const first = await execute('{ tradeHistory(limit: 1) { trades { id } pageInfo { totalCount hasNextPage hasPreviousPage } } }');
    assert.deepEqual(first.data.tradeHistory.trades.map((trade) => trade.id), ['trade-1']);
    assert.equal(first.data.tradeHistory.pageInfo.totalCount, 2);
    assert.equal(first.data.tradeHistory.pageInfo.hasNextPage, true);

    const second = await execute('{ tradeHistory(limit: 1, offset: 1) { trades { id } pageInfo { hasNextPage hasPreviousPage } } }');
    assert.deepEqual(second.data.tradeHistory.trades.map((trade) => trade.id), ['trade-2']);
    assert.equal(second.data.tradeHistory.pageInfo.hasNextPage, false);
    assert.equal(second.data.tradeHistory.pageInfo.hasPreviousPage, true);
  });

  it('paginates portfolio positions and keeps tax totals over all matching events', async () => {
    const overview = await execute('{ portfolioOverview(limit: 1) { positions { symbol } pageInfo { totalCount hasNextPage } } }');
    assert.equal(overview.data.portfolioOverview.positions.length, 1);
    assert.equal(overview.data.portfolioOverview.pageInfo.totalCount, 2);
    assert.equal(overview.data.portfolioOverview.pageInfo.hasNextPage, true);

    const estimate = await execute('{ taxEstimate(taxYear: 2026, limit: 0) { totalProceeds estimatedTax events { id } pageInfo { totalCount } } }');
    assert.equal(estimate.data.taxEstimate.totalProceeds, 720);
    assert.equal(estimate.data.taxEstimate.estimatedTax, 28.51);
    assert.deepEqual(estimate.data.taxEstimate.events, []);
    assert.equal(estimate.data.taxEstimate.pageInfo.totalCount, 1);
  });

  it('surfaces upstream errors while returning partial finance data', async () => {
    finance = createFinanceService({
      connectors: {
        openTrading: {
          listAccounts: async () => [{ acct_id: 'acct-1', display_name: 'Primary Brokerage', account_type: 'BROKERAGE', base_currency: 'USD', source: 'OpenTrading' }],
          listTrades: async () => [],
          listOrders: async () => [],
        },
        portfolioWatcher: {
          listPositions: async () => {
            throw new Error('positions endpoint timed out');
          },
          listPerformanceSnapshots: async () => [],
        },
        taxBreak: {
          mapTradesToTaxEvents: async () => [],
          estimateTax: async ({ events, taxYear }) => ({
            taxYear,
            currency: 'USD',
            totalProceeds: 0,
            totalCostBasis: 0,
            realizedGain: 0,
            estimatedTax: 0,
            taxRate: 0.22,
            events,
            errors: [],
          }),
        },
      },
    });

    const result = await execute(`{
      portfolioOverview {
        accounts { id name }
        positions { symbol }
        totalMarketValue
        errors { source code category status retryable message }
      }
    }`);

    assert.equal(result.errors, undefined);
    assert.equal(result.data.portfolioOverview.accounts.length, 1);
    assert.deepEqual(result.data.portfolioOverview.positions, []);
    assert.equal(result.data.portfolioOverview.totalMarketValue, 0);
    assert.equal(result.data.portfolioOverview.errors[0].source, 'Portfolio-Watcher');
    assert.equal(result.data.portfolioOverview.errors[0].code, 'UPSTREAM_UNKNOWN');
    assert.equal(result.data.portfolioOverview.errors[0].category, 'UNKNOWN');
    assert.equal(result.data.portfolioOverview.errors[0].status, null);
    assert.equal(result.data.portfolioOverview.errors[0].retryable, false);
    assert.match(result.data.portfolioOverview.errors[0].message, /positions endpoint timed out/);
  });
});
