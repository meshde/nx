import {
  createProjectGraphAsync,
  logger,
  parseTargetString,
  ProjectGraph,
  ProjectGraphDependency,
  readProjectConfiguration,
  stripIndents,
  TargetConfiguration,
  Tree,
  reverse,
  readTargetOptions,
  ExecutorContext,
  workspaceRoot,
  readNxJson,
} from '@nrwl/devkit';
import { readProjectsConfigurationFromProjectGraph } from 'nx/src/project-graph/project-graph';

interface FindTargetOptions {
  project: string;
  /**
   * contains buildable target such as react app or angular app
   * <project>:<target>[:<configuration>]
   */
  buildTarget?: string;
  validExecutorNames: Set<string>;
}

interface FoundTarget {
  config: TargetConfiguration;
  target: string;
}

export async function findBuildConfig(
  tree: Tree,
  options: FindTargetOptions
): Promise<FoundTarget> {
  // attempt to use the provided target
  const graph = await createProjectGraphAsync();
  if (options.buildTarget) {
    return {
      target: options.buildTarget,
      config: findInTarget(tree, graph, options),
    };
  }
  // check to see if there is a valid config in the given project
  const selfProject = findTargetOptionsInProject(
    tree,
    graph,
    options.project,
    options.validExecutorNames
  );
  if (selfProject) {
    return selfProject;
  }

  // attempt to find any projects with the valid config in the graph that consumes this project
  return await findInGraph(tree, graph, options);
}

function findInTarget(
  tree: Tree,
  graph: ProjectGraph,
  options: FindTargetOptions
): TargetConfiguration {
  const { project, target, configuration } = parseTargetString(
    options.buildTarget
  );
  const projectConfig = readProjectConfiguration(tree, project);
  const foundConfig =
    configuration || projectConfig?.targets?.[target]?.defaultConfiguration;

  return readTargetOptions(
    { project, target, configuration: foundConfig },
    createExecutorContext(
      graph,
      projectConfig.targets,
      project,
      target,
      foundConfig
    )
  );
}

async function findInGraph(
  tree: Tree,
  graph: ProjectGraph,
  options: FindTargetOptions
): Promise<FoundTarget> {
  const parents = findParentsOfProject(graph, options.project);
  const potentialTargets = [];

  for (const parent of parents) {
    const parentProject = findTargetOptionsInProject(
      tree,
      graph,
      parent.target,
      options.validExecutorNames
    );
    if (parentProject) {
      potentialTargets.push(parentProject);
    }
  }

  if (potentialTargets.length > 1) {
    logger.warn(stripIndents`Multiple potential targets found for ${options.project}. Found ${potentialTargets.length}. 
    Using ${potentialTargets[0].target}.
    To specify a different target use the --build-target flag.
    `);
  }
  return potentialTargets[0];
}

function findParentsOfProject(
  graph: ProjectGraph,
  projectName: string
): ProjectGraphDependency[] {
  const reversedGraph = reverse(graph);
  return reversedGraph.dependencies[projectName]
    ? Object.values(reversedGraph.dependencies[projectName])
    : [];
}

function findTargetOptionsInProject(
  tree: Tree,
  graph: ProjectGraph,
  projectName: string,
  includes: Set<string>
): FoundTarget {
  const projectConfig = readProjectConfiguration(tree, projectName);

  for (const targetName in projectConfig.targets) {
    const targetConfig = projectConfig.targets[targetName];
    if (includes.has(targetConfig.executor)) {
      return {
        target: `${projectName}:${targetName}`,
        config: readTargetOptions(
          { project: projectName, target: targetName },
          createExecutorContext(
            graph,
            projectConfig.targets,
            projectName,
            targetName,
            null
          )
        ),
      };
    }
  }
}

function createExecutorContext(
  graph: ProjectGraph,
  targets: Record<string, TargetConfiguration>,
  projectName: string,
  targetName: string,
  configurationName?: string
): ExecutorContext {
  const projectConfigs = readProjectsConfigurationFromProjectGraph(graph);
  return {
    cwd: process.cwd(),
    projectGraph: graph,
    target: targets[targetName],
    targetName,
    configurationName,
    root: workspaceRoot,
    isVerbose: false,
    projectName,
    workspace: {
      ...readNxJson(),
      ...projectConfigs,
    },
  };
}
