const originalFetch = globalThis.fetch
let telegramUpdateDelivered = false
let creditCapacityRetryRequests = 0
let creditBudgetRetryRequests = 0
let groqRateLimitRetryRequests = 0

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url)
  if (url.hostname === 'api.telegram.org') {
    const method = url.pathname.split('/').pop()
    if (method === 'getWebhookInfo') {
      return Response.json({ ok: true, result: { url: '' } })
    }
    if (method === 'setMyCommands') {
      return Response.json({ ok: true, result: true })
    }
    if (method === 'getUpdates') {
      if (!telegramUpdateDelivered) {
        telegramUpdateDelivered = true
        return Response.json({
          ok: true,
          result: [{
            update_id: 1,
            message: { text: process.env.MOCK_TELEGRAM_UPDATE_TEXT || '/search long telegram test', chat: { id: 123 }, from: { id: 123 } },
          }],
        })
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
      return Response.json({ ok: true, result: [] })
    }
    if (method === 'sendMessage') {
      const { text, chat_id: chatId } = JSON.parse(init.body)
      if (String(chatId) === '429') {
        return Response.json({ ok: false, description: 'Telegram rate limit.' }, { status: 429 })
      }
      if (String(chatId) === '-987') throw new DOMException('The operation timed out.', 'TimeoutError')
      if (text.length > 4000) {
        return Response.json({ ok: false, description: 'Message is too long.' }, { status: 400 })
      }
      return Response.json({ ok: true, result: { message_id: 1 } })
    }
  }

  if (url.hostname === 'calendarific.com') {
    if (url.searchParams.get('api_key') !== 'test-calendar-key' || url.searchParams.get('location') !== 'in-up') {
      return Response.json({ meta: { code: 401 }, response: { holidays: [] } }, { status: 401 })
    }
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())
    const date = `${parts.find((part) => part.type === 'year').value}-${parts.find((part) => part.type === 'month').value}-${parts.find((part) => part.type === 'day').value}`
    return Response.json({
      meta: { code: 200 },
      response: {
        holidays: [{
          name: 'Verified Test Festival',
          date: { iso: date },
          type: ['Religious holiday'],
          locations: ['Uttar Pradesh'],
        }],
      },
    })
  }

  if (url.hostname === 'api.github.com' && url.pathname.endsWith('/events/public')) {
    return Response.json([{
      id: 'mock-github-event-1',
      type: 'PushEvent',
      repo: { name: 'octocat/hello-world' },
      payload: { commits: [{ sha: 'abc123' }] },
      created_at: '2026-11-12T10:00:00Z',
    }])
  }

  if (url.hostname === 'www.googleapis.com' && url.pathname === '/youtube/v3/channels') {
    if (url.searchParams.get('mine') === 'true'
      && new Headers(init?.headers).get('authorization') !== 'Bearer oauth-access-refreshed-test') {
      return Response.json({ error: { message: 'Channel discovery requires the authorized account.' } }, { status: 401 })
    }
    return Response.json({
      items: [{
        id: 'UC1234567890123456789012',
        snippet: {
          title: 'Caash Aminati',
          description: 'Mock authorized channel',
          customUrl: '@caashaminati',
          publishedAt: '2020-01-01T00:00:00Z',
          thumbnails: { default: { url: 'https://img.youtube.test/channel.jpg' } },
        },
        statistics: {
          viewCount: '12345',
          subscriberCount: '789',
          hiddenSubscriberCount: false,
          videoCount: '2',
        },
        contentDetails: { relatedPlaylists: { uploads: 'mock-uploads' } },
      }],
    })
  }

  if (url.hostname === 'www.googleapis.com' && url.pathname === '/youtube/v3/playlistItems') {
    return Response.json({
      items: [{
        contentDetails: { videoId: 'mock-video-1', videoPublishedAt: '2026-11-12T11:00:00Z' },
        snippet: { title: 'Mock public upload', description: 'Mock description' },
      }, {
        contentDetails: { videoId: 'mock-video-2', videoPublishedAt: '2026-11-13T11:00:00Z' },
        snippet: { title: 'Second mock upload', description: 'Another mock description' },
      }],
    })
  }

  if (url.hostname === 'www.googleapis.com' && url.pathname === '/youtube/v3/videos') {
    return Response.json({
      items: ['mock-video-1', 'mock-video-2'].map((id, index) => ({
        id,
        snippet: {
          title: index ? 'Second mock upload' : 'Mock public upload',
          description: index ? 'Another mock description' : 'Mock description',
          publishedAt: index ? '2026-11-13T11:00:00Z' : '2026-11-12T11:00:00Z',
          thumbnails: { default: { url: 'https://img.youtube.test/video.jpg' } },
        },
        contentDetails: { duration: 'PT3M12S' },
        statistics: { viewCount: '1234', likeCount: '56', commentCount: '7' },
      })),
    })
  }

  if (url.hostname === 'www.googleapis.com' && url.pathname === '/youtube/v3/commentThreads') {
    return Response.json({ items: [] })
  }

  if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/token') {
    const form = new URLSearchParams(init.body)
    if (form.get('grant_type') === 'authorization_code') {
      return Response.json({
        access_token: 'oauth-access-test',
        refresh_token: 'oauth-refresh-test',
        expires_in: 1,
        scope: [
          'https://www.googleapis.com/auth/youtube.readonly',
          'https://www.googleapis.com/auth/yt-analytics.readonly',
        ].join(' '),
        token_type: 'Bearer',
      })
    }
    if (form.get('grant_type') === 'refresh_token') {
      return Response.json({
        access_token: 'oauth-access-refreshed-test',
        expires_in: 3600,
        scope: [
          'https://www.googleapis.com/auth/youtube.readonly',
          'https://www.googleapis.com/auth/yt-analytics.readonly',
        ].join(' '),
        token_type: 'Bearer',
      })
    }
    return Response.json({ error: 'unsupported_grant_type' }, { status: 400 })
  }

  if (url.hostname === 'youtubeanalytics.googleapis.com' && url.pathname === '/v2/reports') {
    if (new Headers(init?.headers).get('authorization') !== 'Bearer oauth-access-refreshed-test') {
      return Response.json({ error: { message: 'Invalid OAuth bearer token.' } }, { status: 401 })
    }
    if (url.searchParams.get('ids') !== 'channel==UC1234567890123456789012') {
      return Response.json({ error: { message: 'Analytics query did not use the authorized channel ID.' } }, { status: 400 })
    }
    const dimensions = (url.searchParams.get('dimensions') || '').split(',').filter(Boolean)
    const metrics = (url.searchParams.get('metrics') || '').split(',').filter(Boolean)
    const videoFilter = url.searchParams.get('filters') || ''
    const videoIds = videoFilter.startsWith('video==') ? videoFilter.slice('video=='.length).split(',') : []
    if (dimensions.includes('video') && !videoIds.length) {
      return Response.json({ error: { message: 'Video dimensions require a video filter in this test.' } }, { status: 400 })
    }
    const values = {
      views: 321,
      estimatedMinutesWatched: 654.5,
      averageViewDuration: 120,
      averageViewPercentage: 45,
      subscribersGained: 12,
      subscribersLost: 2,
      likes: 34,
      comments: 5,
      shares: 3,
      viewerPercentage: 55.5,
    }
    const headers = [
      ...dimensions.map((name) => ({ name, dataType: 'STRING' })),
      ...metrics.map((name) => ({ name, dataType: name === 'averageViewPercentage' || name === 'viewerPercentage' ? 'FLOAT' : 'INTEGER' })),
    ]
    const dimensionValues = {
      day: url.searchParams.get('endDate'),
      video: videoIds[0] || 'mock-video-1',
      country: 'US',
      ageGroup: 'AGE_25_34',
      gender: 'FEMALE',
      deviceType: 'MOBILE',
      insightTrafficSourceType: 'YT_SEARCH',
    }
    const row = [...dimensions.map((name) => dimensionValues[name]), ...metrics.map((name) => values[name])]
    const rows = dimensions.includes('video')
      ? videoIds.map((videoId) => [...dimensions.map((name) => name === 'video' ? videoId : dimensionValues[name]), ...metrics.map((name) => values[name])])
      : dimensions.includes('ageGroup')
      ? [
        row,
        [...dimensions.map((name) => name === 'gender' ? 'MALE' : dimensionValues[name]), ...metrics.map((name) => name === 'viewerPercentage' ? 44.5 : values[name])],
      ]
      : [row]
    return Response.json({
      columnHeaders: headers,
      rows,
    })
  }

  if (url.hostname === 'api.tavily.com') {
    const request = JSON.parse(init.body)
    if (url.pathname.endsWith('/search')) {
      if (request.topic === 'news') {
        return Response.json({
          results: [{
            title: 'New Generative AI research breakthrough announced',
            url: 'https://reuters.com/technology/generative-ai-breakthrough',
            content: 'Researchers announced a new Generative AI model with improved capabilities.',
            published_date: new Date().toISOString(),
          }],
        })
      }
      if (request.query.includes('Large Jobs Co')) {
        return Response.json({
          results: ['token-limit-27', 'job-a-27', 'job-b-27'].map((jobId) => ({
            title: `Software Engineer Intern ${jobId}`,
            url: `https://careers.example.com/jobs/${jobId}`,
            content: 'Official internship vacancy.',
          })),
        })
      }
      if (request.query.includes('CreditRetryCo') || request.query.includes('CreditBudgetCo')) {
        return Response.json({
          results: [{
            title: 'Software Engineer Intern job-a-27',
            url: 'https://careers.example.com/jobs/job-a-27',
            content: 'Official internship vacancy.',
          }],
        })
      }
      if (request.query.trimStart().startsWith('FailCo ')) {
        return Response.json({ error: { message: 'Temporary search failure' } }, { status: 503 })
      }
      if (request.query.includes('RateLimitCo')) {
        return Response.json({ error: { message: 'Search rate limit.' } }, { status: 429 })
      }
      if (request.query.trimStart().startsWith('TimeoutCo ')) {
        throw new DOMException('The operation timed out.', 'TimeoutError')
      }
      if (request.query.includes('LlmFailCo') || request.query.includes('NotificationCo')
        || request.query.includes('LlmTimeoutCo') || request.query.includes('TelegramTimeoutCo')) {
        const jobId = request.query.includes('LlmFailCo') ? 'llm-fail-27'
          : request.query.includes('LlmTimeoutCo') ? 'llm-timeout-27'
            : request.query.includes('TelegramTimeoutCo') ? 'telegram-timeout-27'
              : request.query.includes('NotificationCo') ? 'notification-27' : 'INT-27'
        return Response.json({
          results: [{ title: 'Software Engineer Intern', url: `https://careers.example.com/jobs/${jobId}`, content: 'Official internship vacancy.' }],
        })
      }
      if (request.query.includes('ExtractFailCo')) {
        return Response.json({
          results: [{ title: 'Software Engineer Intern', url: 'https://careers.example.com/jobs/extract-fail-27', content: 'Official internship vacancy.' }],
        })
      }
      if (request.query.includes('ExtractTimeoutCo')) {
        return Response.json({
          results: [{ title: 'Software Engineer Intern', url: 'https://careers.example.com/jobs/extract-timeout-27', content: 'Official internship vacancy.' }],
        })
      }
      if (request.query.includes('SlowCo')) await new Promise((resolve) => setTimeout(resolve, 250))
      if (request.query.includes('Example Systems') || request.query.includes('NotificationCo')
        || request.query.includes('LlmFailCo') || request.query.includes('GroqTPMRetryCo')) {
        return Response.json({
          results: [{
            title: 'Software Engineer Intern',
            url: 'https://careers.example.com/jobs/INT-27',
            content: 'Official internship vacancy.',
          }],
        })
      }
      return Response.json({
        results: [{ title: 'Test source', url: 'https://example.test', content: 'Test search result.' }],
      })
    }
    if (url.pathname.endsWith('/extract')) {
      if (request.urls.some((pageUrl) => pageUrl.includes('extract-fail'))) {
        return Response.json({ error: { message: 'Temporary extraction failure.' } }, { status: 503 })
      }
      if (request.urls.some((pageUrl) => pageUrl.includes('extract-timeout'))) {
        throw new DOMException('The operation timed out.', 'TimeoutError')
      }
      return Response.json({
        results: request.urls.map((pageUrl) => {
          if (pageUrl.includes('/token-limit-27') || pageUrl.includes('/job-a-27') || pageUrl.includes('/job-b-27')) {
            const jobId = pageUrl.split('/').pop()
            const title = `Software Engineer Intern ${jobId}`
            return {
              url: pageUrl,
              raw_content: [
                `<script>${'tracking script '.repeat(12000)}</script>`,
                `<nav>${'Home Careers About '.repeat(5000)}</nav>`,
                `${title}.`,
                `Title: ${title}.`,
                `Job ID: ${jobId}.`,
                'Applications are open.',
                'Graduation year 2027.',
                "Bachelor's degree in Computer Science.",
                'Minimum CGPA 7.0.',
                'No active backlogs.',
                'Experience: 0 years of experience.',
                'Employment type: Internship.',
                'Location: Bengaluru.',
                'Skills: Java and Python.',
                'Apply by December 31, 2026.',
              ].join('\n'),
            }
          }
          return {
            url: pageUrl,
            raw_content: [
              'Software Engineer Intern 2027.',
              'Title: Software Engineer Intern.',
              'Job ID: INT-27.',
              'Applications are open.',
              'Graduation year 2027.',
              "Bachelor's degree in Computer Science.",
              'Minimum CGPA 7.0.',
              'No active backlogs.',
              'Experience: 0 years of experience.',
              'Employment type: Internship.',
              'Location: Bengaluru.',
              'Skills: Java and Python.',
              'Apply by December 31, 2026.',
            ].join(' '),
          }
        }),
      })
    }
    return Response.json({
      results: [{ title: 'Test source', url: 'https://example.test', content: 'Test search result.' }],
    })
  }

  if (url.hostname === 'openrouter.ai' && url.pathname.endsWith('/chat/completions')) {
    const request = JSON.parse(init.body)
    const authorization = new Headers(init?.headers).get('authorization')
    if (!authorization?.startsWith('Bearer ')) {
      return Response.json({ error: { message: 'Invalid API Key' } }, { status: 401 })
    }
    if (request.model !== 'perplexity/sonar') {
      return Response.json({ error: { message: 'Unexpected OpenRouter model.' } }, { status: 400 })
    }
    const instructions = request.messages[0].content
    if (!instructions.includes('Extract only current job vacancies')) {
      return Response.json({ choices: [{ message: { content: 'Mock OpenRouter response' } }] })
    }
    if (instructions.includes('LlmFailCo')) {
      return Response.json({ error: { message: 'Temporary LLM failure.' } }, { status: 503 })
    }
    if (instructions.includes('CreditRetryCo') && creditCapacityRetryRequests++ === 0) {
      return Response.json({
        error: { message: 'This request would exceed your available credits given your current in-flight requests. Retry after in-flight requests settle, or add credits.' },
      }, { status: 402 })
    }
    if (instructions.includes('CreditBudgetCo')) {
      if (creditBudgetRetryRequests++ === 0) {
        return Response.json({
          error: { message: 'This request requires more credits, or fewer max_tokens. You requested up to 1200 tokens, but can only afford 434.' },
        }, { status: 402 })
      }
      if (request.max_tokens !== 434) {
        return Response.json({ error: { message: 'Retry did not use the reported completion-token limit.' } }, { status: 400 })
      }
    }
    const pageData = instructions.match(/Fetched official career pages:\s*([\s\S]+)$/)?.[1] || '[]'
    const pages = JSON.parse(pageData)
    if (pages.length !== 1) {
      return Response.json({ error: { message: 'Expected one page per job extraction request.' } }, { status: 400 })
    }
    if (pages[0].url.includes('/token-limit-27')) {
      return Response.json({ error: { message: 'Prompt tokens limit exceeded: 13283 > 11938' } }, { status: 400 })
    }
    const content = pages[0].content
    const excerpt = (text) => content.includes(text) ? text : undefined
    const company = instructions.match(/Company: ([^.]+)/)?.[1] || 'Large Jobs Co'
    const jobId = pages[0].url.split('/').pop()
    const title = `Software Engineer Intern ${jobId}`
    return Response.json({
      choices: [{
        message: {
          content: JSON.stringify([{
            company,
            title,
            sourceUrl: pages[0].url,
            jobId,
            location: 'Bengaluru',
            deadline: 'December 31, 2026',
            experience: '0 years of experience',
            maxBacklogs: 0,
            backlogRequirement: 'No active backlogs',
            eligibleGraduationYears: ['2027'],
            requiredDegrees: ["Bachelor's degree"],
            requiredBranches: ['Computer Science'],
            minimumCgpa: 7,
            skills: ['Java', 'Python'],
            employmentType: 'Internship',
            salary: '',
            openStatus: 'open',
            evidence: {
              title: excerpt(`Title: ${title}.`),
              openStatus: excerpt('Applications are open.'),
              jobId: excerpt(`Job ID: ${jobId}.`),
              location: excerpt('Location: Bengaluru.'),
              deadline: excerpt('Apply by December 31, 2026.'),
              eligibleGraduationYears: excerpt('Graduation year 2027.'),
              requiredDegrees: excerpt("Bachelor's degree in Computer Science."),
              requiredBranches: excerpt("Bachelor's degree in Computer Science."),
              minimumCgpa: excerpt('Minimum CGPA 7.0.'),
              maxBacklogs: excerpt('No active backlogs.'),
              backlogRequirement: excerpt('No active backlogs.'),
              experience: excerpt('Experience: 0 years of experience.'),
              employmentType: excerpt('Employment type: Internship.'),
              skills: excerpt('Skills: Java and Python.'),
            },
          }]),
        },
      }],
      usage: { prompt_tokens: Math.ceil(JSON.stringify(request.messages).length / 3), completion_tokens: 300 },
    })
  }

  if (url.hostname === 'api.groq.com') {
    const authorization = new Headers(init?.headers).get('authorization')
    if (url.pathname.endsWith('/chat/completions')) {
      if (authorization !== 'Bearer saved-test-key') {
        return Response.json({ error: { message: 'Invalid API Key' } }, { status: 401 })
      }
      if (JSON.parse(init.body).model !== 'openai/gpt-oss-120b') {
        return Response.json({ error: { message: 'Unexpected or retired Groq model.' } }, { status: 400 })
      }
      const request = JSON.parse(init.body)
      if (request.messages[0].content.includes('Summarize only the supplied news')) {
        const articles = JSON.parse(request.messages[1].content)
        return Response.json({
          choices: [{
            message: {
              content: JSON.stringify(articles.map((article) => ({
                index: article.index,
                headline: article.title,
                summary: 'A new model was announced.',
                whyItMatters: 'It may influence AI capabilities and products.',
              }))),
            },
          }],
          usage: { prompt_tokens: 120, completion_tokens: 40 },
        })
      }
      if (request.messages.some((message) => message.content.includes('Extract only current job vacancies'))) {
        if (request.messages[0].content.includes('LlmFailCo')) {
          return Response.json({ error: { message: 'Temporary LLM failure.' } }, { status: 503 })
        }
        if (request.messages[0].content.includes('GroqTPMRetryCo') && groqRateLimitRetryRequests++ === 0) {
          return Response.json({
            error: { message: 'Rate limit reached for model. Please try again in 0.01s.' },
          }, { status: 429 })
        }
        if (request.messages[0].content.includes('LlmTimeoutCo')) {
          throw new DOMException('The operation timed out.', 'TimeoutError')
        }
        const pageData = request.messages[0].content.match(/Fetched official career pages:\s*([\s\S]+)$/)?.[1] || '[]'
        const pages = JSON.parse(pageData)
        const content = pages[0].content
        const excerpt = (text) => content.includes(text) ? text : undefined
        const company = request.messages[0].content.match(/Company: ([^.]+)/)?.[1] || 'Example Systems'
        return Response.json({
          choices: [{
            message: {
              content: JSON.stringify([{
                company,
                title: 'Software Engineer Intern',
                sourceUrl: pages[0].url,
                jobId: 'INT-27',
                location: 'Bengaluru',
                deadline: 'December 31, 2026',
                experience: '0 years of experience',
                maxBacklogs: 0,
                backlogRequirement: 'No active backlogs',
                eligibleGraduationYears: ['2027'],
                requiredDegrees: ["Bachelor's degree"],
                requiredBranches: ['Computer Science'],
                minimumCgpa: 7,
                skills: ['Java', 'Python'],
                employmentType: 'Internship',
                salary: '',
                openStatus: 'open',
                evidence: {
                  company: excerpt(`${company}.`),
                  title: excerpt('Title: Software Engineer Intern.'),
                  openStatus: excerpt('Applications are open.'),
                  jobId: excerpt('Job ID: INT-27.'),
                  location: excerpt('Location: Bengaluru.'),
                  deadline: excerpt('Apply by December 31, 2026.'),
                  eligibleGraduationYears: excerpt('Graduation year 2027.'),
                  requiredDegrees: excerpt("Bachelor's degree in Computer Science."),
                  requiredBranches: excerpt("Bachelor's degree in Computer Science."),
                  minimumCgpa: excerpt('Minimum CGPA 7.0.'),
                  maxBacklogs: excerpt('No active backlogs.'),
                  backlogRequirement: excerpt('No active backlogs.'),
                  experience: excerpt('Experience: 0 years of experience.'),
                  employmentType: excerpt('Employment type: Internship.'),
                  skills: excerpt('Skills: Java and Python.'),
                },
              }]),
            },
          }],
        })
      }
      return Response.json({
        choices: [{
          message: {
            content: JSON.parse(init.body).messages.some((message) => message.content.includes('long telegram test'))
              ? 'x'.repeat(8100)
              : 'Mock Groq response',
          },
        }],
        usage: { total_tokens: 10 },
      })
    }
    if (url.pathname.endsWith('/models')) {
      return authorization === 'Bearer draft-test-key'
        ? Response.json({ data: [] })
        : Response.json({ error: { message: 'Invalid API Key' } }, { status: 401 })
    }
  }

  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
    return originalFetch(input, init)
  }
  throw new Error('Unmocked external request in backend integration test.')
}
