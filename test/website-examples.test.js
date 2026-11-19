import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { execute, getOperationAST, parse, subscribe, validate } from 'graphql';

import { createStore } from '../src/data/store.js';
import { createSchema } from '../src/schema.js';
import { createFinanceService } from '../src/services/financeService.js';
import { createPubSub } from '../src/streaming/pubsub.js';
import { exampleGroups, explorerExamples, schemaFields } from '../website/src/explorerExamples.js';
import { detectOperationType } from '../website/src/graphqlClient.js';

const schema = createSchema();

// Guards the website's API Explorer against drifting from the real API.
describe('website explorer examples', () => {
  it('lists exactly the schema root fields and their arguments', () => {
    assert.deepEqual(Object.keys(schemaFields), ['Query', 'Mutation', 'Subscription']);
    for (const [typeName, fields] of Object.entries(schemaFields)) {
      const actual = Object.fromEntries(
        Object.values(schema.getType(typeName).getFields()).map((field) => [field.name, field.args.map((arg) => arg.name)])
      );
      assert.deepEqual(fields, actual, `${typeName} fields`);
    }
  });

  it('runs every example against a fresh store without errors', async () => {
    for (const example of explorerExamples) {
      assert.ok(exampleGroups.includes(example.group), `${example.id} has an unknown group`);

      const document = parse(example.query);
      assert.deepEqual(validate(schema, document), [], `${example.id} should validate`);

      const operationType = getOperationAST(document).operation;
      assert.equal(detectOperationType(example.query), operationType, `${example.id} operation type`);

      const controller = new AbortController();
      const args = {
        schema,
        document,
        variableValues: example.variables,
        contextValue: { store: createStore(), finance: createFinanceService(), pubsub: createPubSub(), signal: controller.signal },
      };

      if (operationType === 'subscription') {
        const iterator = await subscribe(args);
        assert.equal(typeof iterator[Symbol.asyncIterator], 'function', `${example.id}: ${JSON.stringify(iterator.errors)}`);
        controller.abort();
        await iterator.return();
      } else {
        const result = await execute(args);
        assert.equal(result.errors, undefined, `${example.id}: ${JSON.stringify(result.errors)}`);
        // Every example should show something, not an empty list or null.
        const [value] = Object.values(result.data);
        assert.ok(Array.isArray(value) ? value.length > 0 : value, `${example.id} returned no data`);
      }
    }
  });
});
