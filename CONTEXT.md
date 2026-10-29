# Falkon

Falkon is a self-hosted code context engine: it lets coding agents and people answer questions about one Product at a time from source they can verify, without a model on the serving path. This glossary defines the language used to describe that domain.

## Scope

**Product**:
A named set of repositories that Falkon serves together as one boundary. A Product is neither a repository nor a service, and a question is always asked about exactly one Product.
_Avoid_: Tenant, workspace, search context

**productId**:
The stable name of one Product. Every request, result, and piece of evidence belongs to exactly one `productId`.
_Avoid_: Repository name, context name

**Repository**:
A version-controlled collection of source material. A repository belongs to a Product only through explicit membership, and may belong to several Products.

**Service**:
A running software capability that can depend on other services. A repository may contain several services, so the two are not interchangeable.

**Access policy**:
The rule that decides which of a Product's repositories a caller may see. It can narrow a Product, never widen it.
_Avoid_: Auth, permissions, ACL

## Source and structure

**Index revision**:
The commit of one repository that an index describes. The search index and the graph of the same repository can sit at different index revisions, and every result names the one it read.
_Avoid_: Latest, snapshot, generation

**Declaration unit**:
The source span of one declaration (a function, method, class shell, type, or a file's top-level statements) at an index revision. It is the subject and the returned span of every structural operation.
_Avoid_: Chunk, snippet, node

**Evidence**:
A span of source that supports a result, identified by repository, path, line range, and index revision. Its origin and scope are part of its meaning.
_Avoid_: Snippet, hit, context

**Structural operation**:
A bounded traversal over compiler-resolved relationships between declaration units: callers, callees, references, implementations, a trace between two units, or potential impact. Each relationship it returns carries its own evidence.
_Avoid_: Graph query, graph expansion

**Potential impact**:
The declaration units a change to one unit could affect, inferred from static dependencies in code. It does not claim the effect has been observed at runtime.
_Avoid_: Actual impact, blast radius

**Coverage gap**:
A disclosed part of a repository that a result could not see at its index revision, such as a project the indexer failed on or a file that did not parse. It keeps an empty result from reading as "no effect".
_Avoid_: Error, missing data

## Tools

**Vanilla tool**:
An MCP tool that answers from Falkon's indexes and clones without running a model on the server. Vanilla tools are always available and stay model-free.
_Avoid_: Basic tool, free tool

**Agent tool**:
An MCP tool that runs a server model over vanilla tools to do several steps of work, and returns its claims as checked evidence. Agent tools are offered only when the operator enables them and a model is configured.
_Avoid_: AI tool, smart tool, model tool

## Overview

**Map**:
A deterministic overview of one Product built from its membership, file trees, and graph, with no model involved.
_Avoid_: Summary, architecture doc

**Knowledge base**:
Model-written documents about one repository whose every citation was checked against the repository at the commit they describe. A knowledge base is visible exactly where its owner repository is.
_Avoid_: Wiki, docs, generated summary
