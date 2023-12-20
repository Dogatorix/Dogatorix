require("dotenv").config();
const Mustache = require("mustache");
const fs = require("fs");
const { Octokit } = require("@octokit/rest");

// Set your personal access token
const token = process.env.GH_ACCESS_TOKEN;
const githubUsername = process.env.GH_USERNAME;

const octokit = new Octokit({
  auth: token,
  userAgent: "readme v1.0.0",
  baseUrl: "https://api.github.com",
  log: {
    warn: console.warn,
    error: console.error,
  },
});

async function grabDataFromAllRepositories() {
  const options = {
    per_page: 100,
  };

  try {
    const request = await octokit.rest.repos.listForAuthenticatedUser(options);

    const validRepos = await Promise.all(
      request.data.map(async (repo) => {
        try {
          // Check if the repository exists
          await octokit.rest.repos.get({
            owner: githubUsername,
            repo: repo.name,
          });
          return repo;
        } catch (error) {
          console.warn(`Repository ${repo.owner.login}/${repo.name} not found. Skipping.`);
          return null;
        }
      })
    );

    // Filter out null values (repositories that couldn't be verified)
    const filteredRepos = validRepos.filter((repo) => repo !== null);

    if (filteredRepos.length === 0) {
      throw new Error('No valid repositories found.');
    }

    return filteredRepos;
  } catch (error) {
    console.error('Error retrieving repository data:', error.message);
    throw error;
  }
}

function calculateTotalStars(data) {
  const stars = data.map((repo) => repo.stargazers_count);
  const totalStars = stars.reduce((sum, curr) => sum + curr, 0);
  return totalStars;
}

async function calculateTotalCommits(data, cutoffDate) {


  const contributorsRequests = data.map((repo) => {
    const options = {
      owner: githubUsername,
      repo: repo.name,
    };

    const lastRepoUpdate = new Date(repo.updated_at);

    if (!cutoffDate || lastRepoUpdate > cutoffDate) {
      return octokit.rest.repos.getContributorsStats(options);
    }

    return undefined;
  });

  const validContributorsRequests = contributorsRequests.filter(Boolean);

  const totalCommits = await getTotalCommits(
    validContributorsRequests,
    githubUsername,
    cutoffDate
  );

  return totalCommits;
}

async function getTotalCommits(requests, contributor, cutoffDate) {
  const repos = await Promise.all(requests);
  let totalCommits = 0;

  repos.forEach((repo) => {
    if (Array.isArray(repo.data)) {
      const contributorName = (item) => item.author.login === contributor;
      const indexOfContributor = repo.data.findIndex(contributorName);

      if (indexOfContributor !== -1) {
        const contributorStats = repo.data[indexOfContributor];
        totalCommits += !cutoffDate
          ? computeCommitsFromStart(contributorStats)
          : computeCommitsBeforeCutoff(contributorStats, cutoffDate);
      }
    } else {
      console.warn(`Unexpected data structure in repo.data for ${repo.full_name}`);
      console.log(repo)
    }
  });

  return totalCommits;
}


function computeCommitsFromStart(contributorData) {
  return contributorData.total;
}

function computeCommitsBeforeCutoff(contributorData, cutoffDate) {
  const olderThanCutoffDate = (week) => {
    const MILLISECONDS_IN_A_SECOND = 1000;
    const milliseconds = week.w * MILLISECONDS_IN_A_SECOND;
    const startOfWeek = new Date(milliseconds);
    return startOfWeek > cutoffDate;
  };

  const newestWeeks = contributorData.weeks.filter(olderThanCutoffDate);
  const total = newestWeeks.reduce((sum, week) => sum + week.c, 0);

  return total;
}

async function updateReadme(userData) {
  const TEMPLATE_PATH = "./main.mustache";
  const data = await fs.promises.readFile(TEMPLATE_PATH, "utf-8");

  const output = Mustache.render(data, userData);
  await fs.promises.writeFile("README.md", output);
}



async function main() {
  const repoData = await grabDataFromAllRepositories();

  const repoCount = repoData.length
  const publicRepos = repoData.filter(repo => !repo.private).length;

  const totalStars = calculateTotalStars(repoData);

  const lastYear = new Date();
  lastYear.setFullYear(lastYear.getFullYear() - 1);

  const totalCommitsInPastYear = await calculateTotalCommits(
    repoData,
    lastYear
  );

  const colors = ["6B5369", "251522", "402B3E", "160C14", "090308"];
  await updateReadme({ totalStars, totalCommitsInPastYear, colors, repoCount, publicRepos });
}

main();
