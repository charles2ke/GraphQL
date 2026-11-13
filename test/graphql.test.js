import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { createStore } from '../src/data/store.js';
import { createApolloServer } from '../src/server.js';
import { createFinanceService } from '../src/services/financeService.js';

const server = createApolloServer();
let store;
let finance;

/**
 * Executes an operation against the schema with a fresh in-memory store and
 * returns the result as a client would receive it (JSON, plain objects).
 */
async function execute(query, variables) {
  const response = await server.executeOperation(
    { query, variables },
    { contextValue: { store, finance } }
  );

  return JSON.parse(JSON.stringify(response.body.singleResult));
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

  it('searches and paginates users and posts', async () => {
    const byName = await execute('{ users(search: " TUR ") { name } }');
    assert.deepEqual(byName.data.users, [{ name: 'Alan Turing' }]);

    const paged = await execute('{ users(search: "EXAMPLE.com", limit: 1, offset: 1) { id } }');
    assert.deepEqual(paged.data.users, [{ id: '2' }]);

    const posts = await execute('{ byAuthor: posts(authorId: "2") { id } byText: posts(search: "graphql") { id } beyond: posts(offset: 5) { id } }');
    assert.deepEqual(posts.data, { byAuthor: [{ id: '2' }], byText: [{ id: '1' }], beyond: [] });

    const invalid = await execute('{ posts(offset: -1) { id } }');
    assert.equal(invalid.errors[0].extensions.code, 'BAD_USER_INPUT');
    assert.equal(invalid.errors[0].extensions.category, 'validation');
  });

  it('validates user and post input and keeps emails unique', async () => {
    const invalid = await execute('mutation { createUser(name: "  ", email: "not-an-email") { id } }');
    assert.equal(invalid.errors[0].extensions.code, 'BAD_USER_INPUT');
    assert.deepEqual(invalid.errors[0].extensions.details, ['name must not be empty', 'email must be a valid email address']);

    const tooLong = await execute('mutation ($title: String!) { createPost(title: $title, content: "Body", authorId: "1") { id } }', {
      title: 'x'.repeat(201),
    });
    assert.deepEqual(tooLong.errors[0].extensions.details, ['title must be at most 200 characters']);

    const duplicate = await execute('mutation { createUser(name: "Ada Again", email: " ADA@example.com ") { id } }');
    assert.equal(duplicate.errors[0].extensions.code, 'CONFLICT');
    assert.equal(store.listUsers().length, 2);
    assert.equal(store.listPosts().length, 2);
  });

  it('updates only the provided user and post fields', async () => {
    const renamed = await execute('mutation { updateUser(id: "1", name: " Ada King ") { name email } }');
    assert.deepEqual(renamed.data.updateUser, { name: 'Ada King', email: 'ada@example.com' });

    const ownEmail = await execute('mutation { updateUser(id: "1", email: "ADA@example.com") { email } }');
    assert.equal(ownEmail.data.updateUser.email, 'ADA@example.com');

    const takenEmail = await execute('mutation { updateUser(id: "1", email: "alan@example.com") { id } }');
    assert.equal(takenEmail.errors[0].extensions.code, 'CONFLICT');

    const nothing = await execute('mutation { updateUser(id: "1", name: null) { id } }');
    assert.deepEqual(nothing.errors[0].extensions.details, ['provide at least one of name or email']);

    const post = await execute('mutation { updatePost(id: "2", title: "Computable numbers") { title content } }');
    assert.deepEqual(post.data.updatePost, { title: 'Computable numbers', content: 'Notes about machines that compute.' });

    const unknownUser = await execute('mutation { updateUser(id: "404", name: "Nobody") { id } }');
    assert.equal(unknownUser.errors[0].extensions.code, 'NOT_FOUND');
    const unknownPost = await execute('mutation { updatePost(id: "404", content: "Body") { id } }');
    assert.equal(unknownPost.errors[0].extensions.code, 'NOT_FOUND');
  });

  it('deletes posts and refuses to delete users who still have posts', async () => {
    const blocked = await execute('mutation { deleteUser(id: "1") { id } }');
    assert.equal(blocked.errors[0].extensions.code, 'CONFLICT');
    assert.equal(store.getUser('1').name, 'Ada Lovelace');

    const post = await execute('mutation { deletePost(id: "1") { id title author { name } } }');
    assert.deepEqual(post.data.deletePost, { id: '1', title: 'Hello GraphQL', author: { name: 'Ada Lovelace' } });

    const user = await execute('mutation { deleteUser(id: "1") { id name posts { id } } }');
    assert.deepEqual(user.data.deleteUser, { id: '1', name: 'Ada Lovelace', posts: [] });
    assert.equal((await execute('{ user(id: "1") { id } }')).data.user, null);

    const again = await execute('mutation { deletePost(id: "1") { id } }');
    assert.equal(again.errors[0].extensions.code, 'NOT_FOUND');

    // Ids are never reused after a delete.
    const created = await execute('mutation { createUser(name: "Grace Hopper", email: "grace@example.com") { id } }');
    assert.equal(created.data.createUser.id, '3');
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
    assert.equal(result.data.portfolioOverview.errors[0].message, 'Portfolio-Watcher connector request failed');
  });

  it('returns validation errors for invalid finance date range and pagination args', async () => {
    const invalidDate = await execute('{ tradeHistory(from: "not-a-date") { trades { id } } }');
    assert.equal(invalidDate.errors.length, 1);
    assert.equal(invalidDate.errors[0].extensions.code, 'BAD_USER_INPUT');
    assert.equal(invalidDate.errors[0].extensions.category, 'validation');

    const emptyDate = await execute('{ tradeHistory(from: "") { trades { id } } }');
    assert.equal(emptyDate.errors.length, 1);
    assert.equal(emptyDate.errors[0].extensions.code, 'BAD_USER_INPUT');

    const nonIsoDate = await execute('{ tradeHistory(from: "January 1, 2026") { trades { id } } }');
    assert.equal(nonIsoDate.errors.length, 1);
    assert.equal(nonIsoDate.errors[0].extensions.code, 'BAD_USER_INPUT');

    const invalidRange = await execute('{ tradeHistory(from: "2026-02-01T00:00:00.000Z", to: "2026-01-01T00:00:00.000Z") { trades { id } } }');
    assert.equal(invalidRange.errors.length, 1);
    assert.equal(invalidRange.errors[0].extensions.code, 'BAD_USER_INPUT');

    const invalidLimit = await execute('{ portfolioOverview(limit: -1) { pageInfo { totalCount } } }');
    assert.equal(invalidLimit.errors.length, 1);
    assert.equal(invalidLimit.errors[0].extensions.code, 'BAD_USER_INPUT');
  });

  it('maps unexpected finance resolver failures to api-safe internal errors', async () => {
    finance = {
      portfolioOverview: async () => {
        throw new Error('database credentials leaked');
      },
      tradeHistory: async () => ({ trades: [], orders: [], taxEvents: [], pageInfo: { totalCount: 0, limit: 0, offset: 0, hasNextPage: false, hasPreviousPage: false }, errors: [] }),
      taxEstimate: async () => ({ taxYear: 2026, currency: 'USD', totalProceeds: 0, totalCostBasis: 0, realizedGain: 0, estimatedTax: 0, taxRate: 0.22, events: [], pageInfo: { totalCount: 0, limit: 0, offset: 0, hasNextPage: false, hasPreviousPage: false }, errors: [] }),
    };

    const result = await execute('{ portfolioOverview { totalMarketValue } }');
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].message, 'Finance query failed. Please retry later.');
    assert.equal(result.errors[0].extensions.code, 'INTERNAL_SERVER_ERROR');
    assert.equal(result.errors[0].extensions.category, 'internal');
  });
});
