+++
title = "Elevando o Autoscaling no Kubernetes: Minha Jornada com KEDA"
date = "2026-04-28"
tags = ["Kubernetes", "KEDA", "SRE", "ArgoCD", "GitOps"]
author = "Davi A. Cândido"
+++

# Elevando o Autoscaling no Kubernetes: Minha Jornada com KEDA

Como SRE/DevOps, garantir que a infraestrutura suporte picos de acesso sem desperdiçar recursos ociosos é um desafio diário. Recentemente, decidi ir além do Horizontal Pod Autoscaler (HPA) tradicional e aprofundar o KEDA (Kubernetes Event-Driven Autoscaling).

A experiência transformou a forma como pensamos sobre a elasticidade do cluster. A seguir, apresento um resumo da implementação, das estratégias adotadas e das minhas previsões para o futuro.

### Implementação

O KEDA destaca-se pela sua simplicidade arquitetónica. Funciona como um *Metric Server* estendido, o que significa que não é necessário reescrever a forma como o Kubernetes entende a escalabilidade, basta enriquecer as fontes de dados.

### Estratégias de Scaling

O HPA tradicional, baseado estritamente na CPU e na Memória, muitas vezes falha em cenários em que é necessário sermos proativos em vez de reativos. A grande mudança ocorreu com a migração dessas métricas padrão para estratégias baseadas no tempo junto com o uso de métricas de memória e CPU.

#### O Caso Prático: `app-exemplo`

Substituímos as configurações antigas de HPA por ScaledObjects com triggers do tipo cron, cpu e memória. Aplicamos essa lógica no serviço `app-exemplo`, mapeando janelas de alto tráfego e configurando o KEDA para escalar a aplicação antes que a carga chegasse de fato.

Abaixo, um exemplo da estrutura de configuração utilizada:

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: app-exemplo-scaler
  namespace: dev
spec:
  scaleTargetRef:
    name: app-exemplo
  minReplicaCount: 2
  maxReplicaCount: 10
  triggers:
  - type: cpu
    metadata:
      type: Utilization       # Usar AverageValue ou Utilization
      value: "50"             # Target CPU%
  - type: memory
    metadata:
      type: Utilization
      value: "70"              # Target memory %
  - type: cron
    metadata:
      timezone: America/Sao_Paulo
      start: 0 8 * * 1-5       # Escala no início do horário comercial
      end: 0 19 * * 1-5        # Retorna ao normal no fim do dia
      desiredReplicas: "6"
```

Atualmente, o exemplo utilizado mostra que o `app-exemplo` está com `desiredReplicas=6` apenas durante o horário comercial, que seria o horário de pico dessa aplicação, enquanto nos demais horários, inclusive finais de semana, ele se mantém com apenas dois pods ativos.

Isso, por si só, já ajuda na questão de custo. Porém, em ambientes de desenvolvimento/homologação, pensei: por que não deixar as réplicas configuradas como 0 para reduzir ainda mais os custos?

#### Continuação do Caso Prático: Scale-to-Zero e a Cultura FinOps

A resposta curta para esse questionamento é que o HPA nativo do Kubernetes não permite a escalada para zero. É nesse ponto que o KEDA mostra seu verdadeiro valor estratégico para uma cultura FinOps.

Em ambientes não produtivos, manter pods em execução durante a madrugada ou nos finais de semana é o mesmo que manter as luzes acesas em um escritório vazio. Com o KEDA, podemos ajustar o minReplicaCount para 0, efetivamente "desligando" as aplicações quando a equipe não está trabalhando.

Para aplicar essa estratégia com sucesso, lidamos com duas realidades diferentes em nossa infraestrutura:

* **Ambiente de desenvolvimento (sem ArgoCD)**: como a esteira de desenvolvimento possui uma dinâmica mais fluida e não utiliza o ArgoCD no fluxo atual, os manifestos dos ScaledObjects são aplicados diretamente nas pipelines. O KEDA monitora o cluster e reduz as réplicas a zero após o horário comercial, cortando o consumo computacional na raiz.
* **Ambiente de homologação (com ArgoCD)**: já em homologação, mantemos o rigor do GitOps. O ArgoCD gerencia a aplicação dos manifestos do KEDA, garantindo que o ambiente seja iniciado automaticamente no início do dia para as validações necessárias e "dormir" (zero réplicas) à noite e nos finais de semana, tudo devidamente auditado por meio do repositório.

A configuração para se atingir o Scale-to-Zero é muito simples: basta alterar o limite mínimo e ajustar o comportamento da janela no Cron:

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: app-exemplo-scale-to-zero
  namespace: dev
spec:
  scaleTargetRef:
    name: app-exemplo
  minReplicaCount: 0   # A mágica do FinOps acontece aqui
  maxReplicaCount: 5
  triggers:
  - type: cron
    metadata:
      timezone: America/Sao_Paulo
      start: 0 8 * * 1-5       # Sobe de 0 para as réplicas desejadas às 08:00
      end: 0 19 * * 1-5        # Retorna para o minReplicaCount (0) às 19:00
      desiredReplicas: "2"     # Quantidade de pods durante o horário ativo
```

Essa mudança de paradigma reduziu drasticamente o desperdício de recursos nos nodes do EKS, complementando perfeitamente outras otimizações que vínhamos fazendo na infraestrutura, como o Autoscaling dos nós do Cluster.

#### A Rede de Segurança: Implementando o Fallback no KEDA

Ainda dentro de nossa estratégia de resiliência, não poderíamos ignorar a Lei de Murphy. O que acontece se o KEDA tiver problemas para validar o gatilho (por exemplo, uma falha na API de métricas externa ou indisponibilidade temporária)? Para evitar que a aplicação fique indisponível ou presa a zero réplicas durante uma falha de leitura, implementamos a funcionalidade de Fallback nativa do KEDA.

Ela garante que, se as condições do gatilho não puderem ser validadas após um determinado número de falhas, o deployment assumirá um número seguro e pré-definido de réplicas, mantendo a estabilidade do serviço até que a comunicação seja restabelecida.

Adicionar isso ao nosso ScaledObject foi simples:

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: app-exemplo-scale-to-zero
  namespace: dev
spec:
  scaleTargetRef:
    name: app-exemplo
  minReplicaCount: 0
  maxReplicaCount: 5
  fallback:
    failureThreshold: 3      # Quantidade de falhas consecutivas para ativar o fallback
    replicas: 2              # Número seguro de réplicas que o KEDA deve manter
  triggers:
  - type: cron
    # ... (configurações do trigger cron) ...
```

### O Futuro: Explorando o Potencial Máximo

A base está estabelecida, mas o KEDA oferece um leque de possibilidades que pretendo explorar nas próximas sprints.

1. **Integração com AWS SQS**: para serviços que processam filas, escalar com base no volume do SQS (em vez de uso de CPU) permite uma alocação de trabalhadores muito mais inteligente.
2. **Triggers baseados no Prometheus**: como já temos monitoramento avançado e provisionamento de alertas no Grafana, o próximo passo é criar ScaledObjects que leiam métricas personalizadas do Prometheus, criando uma malha de autoscaling hiperespecífica para as nossas regras de negócio.

### Conclusão:

A transição para o KEDA mudou nossa postura de "reação a gargalos" para "antecipação inteligente". Juntamente com o provisionamento estruturado por meio do Terraform e o controle de estado de homologação pelo ArgoCD, o KEDA mostrou-se uma peça fundamental para uma infraestrutura de Kubernetes verdadeiramente moderna e eficiente.