using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HomeExcursion.Api.Migrations.Home
{
    /// <inheritdoc />
    public partial class RefactorProjectContractorLifecycle : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ProjectClosureItems",
                schema: "home",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ProjectId = table.Column<int>(type: "int", nullable: false),
                    Description = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: false),
                    Status = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    DueDate = table.Column<DateOnly>(type: "date", nullable: true),
                    Notes = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: true),
                    SortOrder = table.Column<int>(type: "int", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    CompletedAt = table.Column<DateTime>(type: "datetime2", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProjectClosureItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ProjectClosureItems_Projects_ProjectId",
                        column: x => x.ProjectId,
                        principalSchema: "home",
                        principalTable: "Projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ProjectContractorActivities",
                schema: "home",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ProjectContractorId = table.Column<int>(type: "int", nullable: false),
                    ActivityType = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    ActivityAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    Summary = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: false),
                    Notes = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProjectContractorActivities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ProjectContractorActivities_ProjectContractors_ProjectContractorId",
                        column: x => x.ProjectContractorId,
                        principalSchema: "home",
                        principalTable: "ProjectContractors",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ProjectContractorProposals",
                schema: "home",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ProjectContractorId = table.Column<int>(type: "int", nullable: false),
                    ReceivedDate = table.Column<DateOnly>(type: "date", nullable: false),
                    RevisionLabel = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    Amount = table.Column<decimal>(type: "decimal(12,2)", precision: 12, scale: 2, nullable: true),
                    Notes = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: true),
                    IsCurrent = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProjectContractorProposals", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ProjectContractorProposals_ProjectContractors_ProjectContractorId",
                        column: x => x.ProjectContractorId,
                        principalSchema: "home",
                        principalTable: "ProjectContractors",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ProjectClosureItems_ProjectId_Status_SortOrder",
                schema: "home",
                table: "ProjectClosureItems",
                columns: new[] { "ProjectId", "Status", "SortOrder" });

            migrationBuilder.CreateIndex(
                name: "IX_ProjectContractorActivities_ProjectContractorId_ActivityAt",
                schema: "home",
                table: "ProjectContractorActivities",
                columns: new[] { "ProjectContractorId", "ActivityAt" });

            migrationBuilder.CreateIndex(
                name: "IX_ProjectContractorProposals_ProjectContractorId_IsCurrent",
                schema: "home",
                table: "ProjectContractorProposals",
                columns: new[] { "ProjectContractorId", "IsCurrent" });

            migrationBuilder.CreateIndex(
                name: "IX_ProjectContractorProposals_ProjectContractorId_ReceivedDate",
                schema: "home",
                table: "ProjectContractorProposals",
                columns: new[] { "ProjectContractorId", "ReceivedDate" });

            // Preserve existing project-specific contractor activity before removing
            // the old VendorActivities table. Old rows created through the project
            // workflow have both VendorId and ProjectId and can be mapped directly
            // to the ProjectContractor association.
            migrationBuilder.Sql("""
                IF EXISTS (
                    SELECT 1
                    FROM [home].[VendorActivities] va
                    WHERE va.[ProjectId] IS NULL
                       OR NOT EXISTS (
                           SELECT 1
                           FROM [home].[ProjectContractors] pc
                           WHERE pc.[VendorId] = va.[VendorId]
                             AND pc.[ProjectId] = va.[ProjectId]
                       )
                )
                BEGIN
                    THROW 50001, 'VendorActivities contains rows that cannot be mapped to ProjectContractorActivities. Migration stopped to prevent data loss.', 1;
                END;

                INSERT INTO [home].[ProjectContractorActivities]
                    ([ProjectContractorId], [ActivityType], [ActivityAt], [Summary], [Notes], [CreatedAt])
                SELECT
                    mapped.[ProjectContractorId],
                    va.[ActivityType],
                    va.[ActivityAt],
                    va.[Summary],
                    va.[Notes],
                    va.[CreatedAt]
                FROM [home].[VendorActivities] va
                CROSS APPLY (
                    SELECT TOP (1) pc.[Id] AS [ProjectContractorId]
                    FROM [home].[ProjectContractors] pc
                    WHERE pc.[VendorId] = va.[VendorId]
                      AND pc.[ProjectId] = va.[ProjectId]
                    ORDER BY pc.[Id]
                ) mapped;
                """);

            migrationBuilder.DropTable(
                name: "VendorActivities",
                schema: "home");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "VendorActivities",
                schema: "home",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ProjectId = table.Column<int>(type: "int", nullable: true),
                    VendorId = table.Column<int>(type: "int", nullable: false),
                    ActivityAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    ActivityType = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    Notes = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: true),
                    Summary = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VendorActivities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_VendorActivities_Projects_ProjectId",
                        column: x => x.ProjectId,
                        principalSchema: "home",
                        principalTable: "Projects",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_VendorActivities_Vendors_VendorId",
                        column: x => x.VendorId,
                        principalSchema: "home",
                        principalTable: "Vendors",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_VendorActivities_ProjectId",
                schema: "home",
                table: "VendorActivities",
                column: "ProjectId");

            migrationBuilder.CreateIndex(
                name: "IX_VendorActivities_VendorId_ActivityAt",
                schema: "home",
                table: "VendorActivities",
                columns: new[] { "VendorId", "ActivityAt" });

            // Restore project-specific activity to the legacy shape if this
            // migration is rolled back.
            migrationBuilder.Sql("""
                INSERT INTO [home].[VendorActivities]
                    ([ProjectId], [VendorId], [ActivityAt], [ActivityType], [CreatedAt], [Notes], [Summary])
                SELECT
                    pc.[ProjectId],
                    pc.[VendorId],
                    a.[ActivityAt],
                    a.[ActivityType],
                    a.[CreatedAt],
                    a.[Notes],
                    a.[Summary]
                FROM [home].[ProjectContractorActivities] a
                INNER JOIN [home].[ProjectContractors] pc
                    ON pc.[Id] = a.[ProjectContractorId]
                WHERE pc.[VendorId] IS NOT NULL;
                """);

            migrationBuilder.DropTable(
                name: "ProjectClosureItems",
                schema: "home");

            migrationBuilder.DropTable(
                name: "ProjectContractorActivities",
                schema: "home");

            migrationBuilder.DropTable(
                name: "ProjectContractorProposals",
                schema: "home");
        }
    }
}
