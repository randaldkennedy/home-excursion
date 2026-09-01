using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HomeExcursion.Api.Migrations.Home
{
    /// <inheritdoc />
    public partial class AddProjectHierarchy : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "ParentProjectId",
                schema: "home",
                table: "Projects",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Projects_ParentProjectId",
                schema: "home",
                table: "Projects",
                column: "ParentProjectId");

            migrationBuilder.AddForeignKey(
                name: "FK_Projects_Projects_ParentProjectId",
                schema: "home",
                table: "Projects",
                column: "ParentProjectId",
                principalSchema: "home",
                principalTable: "Projects",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Projects_Projects_ParentProjectId",
                schema: "home",
                table: "Projects");

            migrationBuilder.DropIndex(
                name: "IX_Projects_ParentProjectId",
                schema: "home",
                table: "Projects");

            migrationBuilder.DropColumn(
                name: "ParentProjectId",
                schema: "home",
                table: "Projects");
        }
    }
}
