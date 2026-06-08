# Org Design Playbook: The First 10 People

Source: QuestForge Bootstrap Library (original, MIT-licensed)

## The minimal SaaS org
A 10-person SaaS that builds, markets, and ships typically organizes into three pods:
- Product pod: founding engineer, product designer, head of product.
- Growth pod: content marketer, partnerships lead, head of growth.
- Operations spine: founder/CEO, plus fractional finance and support.

## Reporting and OKRs
- Keep two layers max until 15 people. Founder owns strategy; pod leads own execution.
- Every pod gets one quarterly objective with 2-3 measurable key results.
- Tie hiring to a key result that is blocked, never to headcount targets.

## Systems the org needs early
- Source control + CI for the product pod.
- CRM + analytics + email for the growth pod.
- Billing (Stripe), auth, and a data warehouse as shared infrastructure.

## Integration map rule of thumb
Product app connects to: auth, billing, analytics. Billing connects to Stripe.
Analytics connects to a warehouse. Growth tools read from the warehouse, not the app.
