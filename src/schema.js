/** GraphQL schema definition for the demo service. */
export const typeDefs = /* GraphQL */ `
  "A person who can author posts."
  type User {
    id: ID!
    name: String!
    email: String!
    "Posts written by this user."
    posts: [Post!]!
  }

  "A piece of content written by a user."
  type Post {
    id: ID!
    title: String!
    content: String!
    "The user who wrote the post."
    author: User!
  }

  type Query {
    "All users."
    users: [User!]!
    "A single user by id, or null when not found."
    user(id: ID!): User
    "All posts."
    posts: [Post!]!
    "A single post by id, or null when not found."
    post(id: ID!): Post
  }

  type Mutation {
    createUser(name: String!, email: String!): User!
    createPost(title: String!, content: String!, authorId: ID!): Post!
  }
`;
