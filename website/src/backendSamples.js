export const backendSamples = [
  {
    language: 'JavaScript',
    framework: 'Apollo Server + Express',
    code: `import { ApolloServer } from '@apollo/server'
import { expressMiddleware } from '@apollo/server/express4'

const typeDefs = \`type Query { hello: String! }\`
const resolvers = { Query: { hello: () => 'Hello from Node.js' } }

const server = new ApolloServer({ typeDefs, resolvers })
await server.start()
app.use('/graphql', expressMiddleware(server))`,
  },
  {
    language: 'TypeScript',
    framework: 'NestJS GraphQL',
    code: `@ObjectType()
class User { @Field() name: string }

@Resolver(() => User)
export class UsersResolver {
  @Query(() => [User])
  users() { return [{ name: 'Ada Lovelace' }] }
}`,
  },
  {
    language: 'Python',
    framework: 'Strawberry + FastAPI',
    code: `@strawberry.type
class Query:
    @strawberry.field
    def hello(self) -> str:
        return "Hello from Python"

schema = strawberry.Schema(query=Query)
app.include_router(GraphQLRouter(schema), prefix="/graphql")`,
  },
  {
    language: 'Java',
    framework: 'Spring for GraphQL',
    code: `@Controller
class UserController {
  @QueryMapping
  List<User> users() {
    return List.of(new User("Ada Lovelace"));
  }
}`,
  },
  {
    language: 'Go',
    framework: 'gqlgen',
    code: `func (r *queryResolver) Users(ctx context.Context) ([]*model.User, error) {
  return []*model.User{{Name: "Ada Lovelace"}}, nil
}

srv := handler.NewDefaultServer(generated.NewExecutableSchema(cfg))
http.Handle("/graphql", srv)`,
  },
  {
    language: 'C#',
    framework: '.NET + Hot Chocolate',
    code: `builder.Services
  .AddGraphQLServer()
  .AddQueryType<Query>();

public class Query {
  public string Hello() => "Hello from .NET";
}

app.MapGraphQL("/graphql");`,
  },
  {
    language: 'PHP',
    framework: 'Laravel Lighthouse',
    code: `type Query {
  users: [User!]! @all
}

type User {
  id: ID!
  name: String!
}`,
  },
  {
    language: 'Ruby',
    framework: 'graphql-ruby',
    code: `field :users, [Types::UserType], null: false

def users
  [{ name: 'Ada Lovelace' }]
end

post '/graphql', to: 'graphql#execute'`,
  },
  {
    language: 'Kotlin',
    framework: 'Ktor + GraphQL Kotlin',
    code: `class UserQuery {
  fun users() = listOf(User(name = "Ada Lovelace"))
}

routing {
  graphQLPostRoute()
}`,
  },
  {
    language: 'Rust',
    framework: 'async-graphql + Axum',
    code: `struct Query;

#[Object]
impl Query {
  async fn hello(&self) -> &str { "Hello from Rust" }
}

let schema = Schema::build(Query, EmptyMutation, EmptySubscription).finish();`,
  },
]
