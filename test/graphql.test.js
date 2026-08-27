import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { createStore } from '../src/data/store.js';
import { createApolloServer } from '../src/server.js';

const server = createApolloServer();
let store;

/** Executes an operation against the schema with a fresh in-memory store. */
async function execute(query, variables) {
  const response = await server.executeOperation(
    { query, variables },
    { contextValue: { store } }
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
});
