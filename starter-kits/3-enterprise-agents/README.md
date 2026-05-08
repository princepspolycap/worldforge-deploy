# 🏢 Enterprise Agents - Starter Kit

**Track**: Battle #3 - Enterprise Agents for Microsoft 365 Copilot  

Welcome to the Enterprise Agents track! In this challenge, you will build intelligent agents that extend **Microsoft 365 Copilot** to address real-world enterprise scenarios. Your goal is to create agents that seamlessly integrate with Microsoft 365 workloads, leveraging the power of AI to automate tasks, enhance productivity, and deliver exceptional user experiences within the enterprise ecosystem.

---

> [!IMPORTANT]
> ## 🎒 Prerequisites - What to Bring
> Before the hackathon, make sure you have the following ready:
> 
> | Requirement | Description |
> |-------------|-------------|
> | 🎫 **Microsoft 365 Copilot License** | You need an active Microsoft 365 Copilot license to test and deploy agents |
> | 🏢 **Tenant with Sideloading Enabled** | Access to a Microsoft 365 tenant where you can sideload custom apps for testing |
> | ☁️ **Azure Subscription** | Required to create resources for Custom Engine Agents (CEA) |

## 💡 Project Ideas

> [!TIP]
> ### Explore Example Enterprise Scenarios
> Need inspiration before you build? Browse solution directions, development approaches, and real-world enterprise use cases on the dedicated [Project Ideas](./project-ideas.md) page.

---

## 🚀 Quick Start

> [!IMPORTANT]
> ### Start Here
> Ready to build? Open the dedicated [Quick Start](./quick-start.md) guide for setup steps, learning resources, and step-by-step paths for Declarative Agents, Custom Engine Agents, and Copilot Studio.

---



## 🛡️ Security & Disclaimer

### Important: Protect Confidential Information

⚠️ **Before submitting your project, please read our [Disclaimer](../../../DISCLAIMER.md).** This is a public repository accessible worldwide.

> [!WARNING]
> ### Security Requirements and Best Practices
> Review the dedicated [Enterprise Security Best Practices](./security-best-practices.md) guide before implementing or submitting your project. This includes required authentication expectations, secret management, data protection, secure development practices, and legal/licensing checks.

#### What You Must NOT Include:

- ❌ Microsoft 365 credentials, access tokens, or tenant IDs
- ❌ Azure API keys, connection strings, or secrets
- ❌ Customer data or personally identifiable information (PII)
- ❌ Confidential or proprietary company information
- ❌ Internal business processes or sensitive organizational data
- ❌ Real production configurations or internal system details

---

## 📋 Requirements & Evaluation

Your solution will be evaluated based on the following requirements and criteria. Meeting these requirements will position your project for success in the competition:

### Core Requirements

Here you can find the fundamental requirements to be satisfied by your agent.

#### 1. Microsoft 365 Copilot Chat Agent (Required)

Your agent **must** be hosted in **Microsoft 365 Copilot Chat**. This means your solution should be designed to run within the Copilot Chat experience, providing users with a seamless conversational interface integrated into the Microsoft 365 ecosystem.

**Important**: Your agent can target **Copilot Free** and does **not** necessarily require a Microsoft 365 Copilot license. This makes your solution accessible to a broader audience, including organizations that have not yet adopted paid Copilot licenses.

### Bonus Criteria (not mandatory)

If you want to get **extra points**, you can also support one or more of the following requirements.

#### 2. Microsoft IQ Integration (Required)

Your agent **must** integrate at least one **Microsoft IQ** intelligence layer. Choose whichever fits your project best:

- [**Foundry IQ**](https://learn.microsoft.com/azure/foundry/agents/concepts/what-is-foundry-iq) — Agentic knowledge retrieval for AI agents. Connects multiple enterprise sources, enforces permissions, and delivers cited, grounded answers to reduce hallucination.
- [**Work IQ**](https://learn.microsoft.com/microsoft-365/copilot/extensibility/workiq-overview) — The intelligence layer behind Microsoft 365 Copilot. Builds memory from emails, meetings, chats, and documents to understand work context, people, and relationships.
- [**Fabric IQ**](https://blog.fabric.microsoft.com/blog/introducing-fabric-iq) — Semantic intelligence layer for Microsoft Fabric. Uses ontologies and knowledge graphs to give business meaning to enterprise data, enabling AI agents to reason over real business concepts.

📖 **Learn more**: [Microsoft IQ Series](https://aka.ms/iq-series)

#### 3. MCP Apps (Higher Rating)

A solution that implements **MCP Apps** will be **rated higher**. This demonstrates that your agent can package MCP capabilities into a more complete Microsoft 365 Copilot extensibility experience, enabling richer enterprise integrations and more reusable agent functionality.

Use this lab as the primary reference when building this capability:

- **MCP Apps Lab**: [Self-paced lab](https://microsoft.github.io/copilot-camp/pages/extend-m365-copilot/11-mcp-app/)

#### 4. External MCP Server Integration (Optional)

Integrating your agent with an external **Model Context Protocol (MCP) server** to read and write specific content is **optional but highly encouraged**. The MCP server acts as a bridge between your agent and external data sources or services, enabling your agent to:

- **Read Operations**: Retrieve data from external systems, databases, or APIs through the MCP server
- **Write Operations**: Create, update, or modify content in external systems through the MCP server

This demonstrates real-world integration capabilities and shows how your agent can interact with enterprise systems beyond the Microsoft 365 ecosystem.

#### 5. OAuth Security for MCP Server (Optional)

Implementing **OAuth-based authentication and authorization** when consuming the MCP server will be **highly appreciated** and will positively impact your evaluation score. Secure MCP server integration should include:

- Proper OAuth 2.0 token acquisition and management
- Secure storage and handling of client credentials
- Token refresh mechanisms to maintain continuous access
- Proper error handling for authentication failures

### Evaluation Summary

Use the rubric below when judging a submission. This format is intended to be easy for an AI evaluator to apply consistently.

Judge using only evidence that is clearly present in the repository, documentation, screenshots, or demo materials. Do not infer features that are only mentioned as future work.

If either required technical item is missing, mark the submission as **incomplete** before calculating the final score.

| Evaluation Area |  Max Score | Weight |
|-----------------|--------------|--------|
| **Technical Implementation** |  **33 points** | **30%** |
| **Accuracy & Relevance** | **10 raw** | **17.5%** |
| **Creativity & Originality** |  **10 raw** | **17.5%** |
| **User Experience & Presentation** |  **10 raw** | **17.5%** |
| **Reliability & Safety** |  **10 raw** | **17.5%** |

Overall scoring formula:

- **Technical weighted score** = `(technical_points / 33) * 30`
- **Each non-technical weighted score** = `(raw_score / 10) * 17.5`

#### Judge Checklist

1. Verify the two required technical items first.
2. Score the technical checklist out of 33 points.
3. Score each non-technical dimension from 0-10 using the rubric descriptions below.
4. Convert each category to its weighted score.
5. Sum the weighted scores for the final result.

#### Technical Checklist

| Technical Criterion | Type | Max Points | AI Judging Guidance |
|---------------------|------|------------|---------------------|
| **Microsoft 365 Copilot Chat Agent** | Required gate | Must pass | Confirm the solution is clearly designed to run in Microsoft 365 Copilot Chat. If evidence is missing, mark the submission incomplete. |
| **Microsoft IQ Integration** | Required gate | Must pass | Confirm at least one Microsoft IQ layer is integrated: Foundry IQ, Work IQ, or Fabric IQ. If evidence is missing, mark the submission incomplete. |
| **MCP Apps** | Higher rating | 20 | Award more points when the submission clearly implements MCP Apps with working integration evidence, meaningful agent capability, and a reusable app experience. Award fewer points for partial or unclear implementation. |
| **External MCP Server Integration (Read/Write)** | Optional | 8 | Award points when the agent clearly reads and/or writes through an MCP server. Full points require convincing evidence of practical integration. |
| **OAuth Security for MCP Server** | Optional | 5 | Award points when OAuth is implemented correctly for MCP access, including secure auth flow, token handling, and clear protection of credentials. |
| **TOTAL TECHNICAL POINTS** |  | **33** |  |

#### Non-Technical Rubric

| Criterion | Raw Score Range | What a High Score Looks Like |
|-----------|-----------------|------------------------------|
| **Accuracy & Relevance** | 0-10 | The agent solves the stated enterprise problem well, produces relevant outputs, and stays aligned with the use case without unnecessary drift. |
| **Creativity & Originality** | 0-10 | The solution shows a distinctive idea, strong problem framing, or a novel use of Microsoft 365 Copilot, IQ, or MCP capabilities. |
| **User Experience & Presentation** | 0-10 | The submission is easy to understand, easy to try, and clearly presented through documentation, demo flow, and interaction design. |
| **Reliability & Safety** | 0-10 | The solution demonstrates robust behaviour, safe tool usage, strong data handling hygiene, clear guardrails, and reasonable failure handling. |



---

## 📚 Resources

Explore the following resources to deepen your knowledge and accelerate your development:

### Reference Links for Technical Evaluation

| Criterion | Copilot Studio | Declarative Agents (DA) with ATK | Custom Engine Agents (CEA) with ATK |
|-----------|----------------|----------------------------------|--------------------------------------|
| **Microsoft 365 Copilot Chat Agent** | [https://microsoft.github.io/copilot-camp/pages/make/copilot-studio/04-extending-m365-copilot/](https://microsoft.github.io/copilot-camp/pages/make/copilot-studio/04-extending-m365-copilot/) | [https://microsoft.github.io/copilot-camp/pages/extend-m365-copilot/01a-geolocator/](https://microsoft.github.io/copilot-camp/pages/extend-m365-copilot/01a-geolocator/) | [https://microsoft.github.io/copilot-camp/pages/custom-engine/agents-sdk/02-agent-with-agents-sdk/](https://microsoft.github.io/copilot-camp/pages/custom-engine/agents-sdk/02-agent-with-agents-sdk/) |
| **Microsoft IQ Integration** | [https://learn.microsoft.com/microsoft-365/copilot/extensibility/workiq-overview](https://learn.microsoft.com/microsoft-365/copilot/extensibility/workiq-overview) | [https://learn.microsoft.com/microsoft-365/copilot/extensibility/workiq-overview](https://learn.microsoft.com/microsoft-365/copilot/extensibility/workiq-overview) | [https://learn.microsoft.com/azure/foundry/agents/concepts/what-is-foundry-iq](https://learn.microsoft.com/azure/foundry/agents/concepts/what-is-foundry-iq) |
| **MCP Apps** |  | [https://microsoft.github.io/copilot-camp/pages/extend-m365-copilot/11-mcp-app/](https://microsoft.github.io/copilot-camp/pages/extend-m365-copilot/11-mcp-app/) |  |
| **External MCP Server Integration (Read/Write)** | [https://microsoft.github.io/copilot-camp/pages/make/copilot-studio/06-mcp/](https://microsoft.github.io/copilot-camp/pages/make/copilot-studio/06-mcp/) | [https://microsoft.github.io/copilot-camp/pages/extend-m365-copilot/08-mcp-server/](https://microsoft.github.io/copilot-camp/pages/extend-m365-copilot/08-mcp-server/) | [https://microsoft.github.io/copilot-camp/pages/custom-engine/agent-framework/07-add-mcp-tools/](https://microsoft.github.io/copilot-camp/pages/custom-engine/agent-framework/07-add-mcp-tools/) |
| **OAuth Security for MCP Server** | [https://microsoft.github.io/agent-academy/operative/10-mcp/](https://microsoft.github.io/agent-academy/operative/10-mcp/) | [https://microsoft.github.io/copilot-camp/pages/extend-m365-copilot/10-mcp-auth/](https://microsoft.github.io/copilot-camp/pages/extend-m365-copilot/10-mcp-auth/) |  |


### Copilot Dev Camp

Your comprehensive learning destination for building agents that extend Microsoft 365 Copilot:

🔗 [https://aka.ms/copilotdevcamp](https://aka.ms/copilotdevcamp)

### Agent Academy

Structured learning paths and expert-led training for mastering agent development with Microsoft Copilot Studio:

🔗 [https://aka.ms/agentacademy](https://aka.ms/agentacademy)

### Microsoft Learn

Access official Microsoft documentation, tutorials, and learning paths:

- **Microsoft 365 Copilot Documentation**: [https://learn.microsoft.com/microsoft-365-copilot/](https://learn.microsoft.com/microsoft-365-copilot/)
- **Copilot Studio Documentation**: [https://learn.microsoft.com/microsoft-copilot-studio/](https://learn.microsoft.com/microsoft-copilot-studio/)
- **Declarative Agents**: [https://aka.ms/declarative-agents-docs](https://aka.ms/declarative-agents-docs)
- **Microsoft 365 Agents Toolkit**: [https://aka.ms/m365-agents-toolkit](https://aka.ms/m365-agents-toolkit)
- **Microsoft Entra ID Documentation**: [https://learn.microsoft.com/entra/identity/](https://learn.microsoft.com/entra/identity/)
- **MCP Apps gallery** :[https://github.com/microsoft/mcp-interactiveUI-samples](https://github.com/microsoft/mcp-interactiveUI-samples)



### Additional Resources

- **Microsoft Graph API**: [https://learn.microsoft.com/graph/](https://learn.microsoft.com/graph/)
- **Microsoft 365 Developer Program**: [https://developer.microsoft.com/microsoft-365/dev-program](https://developer.microsoft.com/microsoft-365/dev-program)

---

## ❓ FAQ

### Can I use vibe-coding?

**Yes!** You are welcome to use vibe-coding approaches and AI-assisted development tools to build your solution. Leveraging AI coding assistants like GitHub Copilot to accelerate your development is encouraged.

### Can I use community and open source libraries/SDKs?

**Yes!** You can use community-contributed and open source libraries, SDKs, and frameworks in your solution. Open source tools are a great way to accelerate development and leverage the collective work of the developer community.

### Can I use commercial/proprietary libraries/SDKs?

**No.** The use of commercial or proprietary libraries and SDKs that require paid licenses or are not freely available is not permitted. Your solution should be built using open source or freely available tools to ensure accessibility and reproducibility.

### Can I share a real project that I've been working on for my company or for a customer?

**No.** You cannot submit existing projects that were developed for your company or for customers. All submissions must be original work created specifically for this hackathon. This ensures a fair competition and protects any confidential or proprietary information.

### Do I need to use my own tenant?

**Yes.** Candidates are expected to use their own Microsoft 365 tenant for development and testing. We recommend using a dedicated developer tenant to avoid impacting production environments. For detailed information on setting up a Copilot development environment, please refer to the [Microsoft 365 Copilot extensibility prerequisites](https://aka.ms/extend-Copilot-sandbox).

---

Questions? Join [Discord](https://aka.ms/agentsleague/discord) #agentsleague channel